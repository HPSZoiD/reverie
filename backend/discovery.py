import json
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from PySide6.QtCore import QObject, Slot
import random
from backend.database import DatabaseManager

class DiscoveryEngine(QObject):
    def __init__(self, db_manager: DatabaseManager):
        super().__init__()
        self.db = db_manager

    @staticmethod
    def normalize_bpm(bpm):
        """Standardizes BPM to 70-140 range matching AutoMix frontend."""
        if not bpm or bpm <= 0: return 120
        while bpm > 140:
            bpm /= 2
        while bpm < 70:
            bpm *= 2
        return bpm

    @staticmethod
    def bpm_compatible(bpm_a, bpm_b, threshold=15):
        """
        Checks if two BPMs are compatible within a threshold, 
        accounting for double-time/half-time relationships.
        Both BPMs are normalized first to ensure a consistent coordinate system.
        """
        if not bpm_a or not bpm_b:
            return True 
            
        norm_a = DiscoveryEngine.normalize_bpm(bpm_a)
        norm_b = DiscoveryEngine.normalize_bpm(bpm_b)
            
        # Delta on normalized values
        if abs(norm_a - norm_b) <= threshold:
            return True
            
        return False

    def _get_feature_matrix(self):
        """
        Retrieves all tracks with features and builds feature matrix.
        Returns: (ids, matrix, track_details_map)
        """
        all_tracks = self.db.get_all_tracks()
        ids = []
        matrix = []
        track_map = {}
        
        for t in all_tracks:
            # t is a sqlite3.Row object
            tid = t['id']
            features_json = t['features_json']
            
            if features_json:
                try:
                    # vec is the 13-dim chroma + centroid vector
                    vec = json.loads(features_json)
                    if len(vec) >= 13:
                        # Add 14th dimension: Normalized BPM (0-200.0 range -> 0-1.0)
                        # We weight it by 2x as requested to give it strong influence
                        raw_tempo = t.get('tempo') or 120
                        tempo = self.normalize_bpm(raw_tempo)
                        bpm_feature = (tempo / 200.0) * 2.0
                        
                        full_vector = vec[:13] + [bpm_feature]
                        
                        ids.append(tid)
                        matrix.append(full_vector)
                        track_map[tid] = dict(t)
                except:
                    pass
                    
        return ids, np.array(matrix) if matrix else None, track_map

    @Slot(int, result=list)
    def find_similar_tracks(self, seed_track_id, limit=5):
        """
        Finds tracks similar to the seed track using Cosine Similarity,
        pre-filtered by BPM compatibility to ensure smooth AutoMix transitions.
        """
        ids, matrix, track_map = self._get_feature_matrix()
        
        if matrix is None or len(ids) == 0:
            return []
            
        if seed_track_id not in ids:
            return []
            
        # 1. Get seed track data
        seed_index = ids.index(seed_track_id)
        seed_vector = matrix[seed_index].reshape(1, -1)
        seed_bpm = track_map[seed_track_id].get('tempo')
        
        # 2. Assign tiers and filter candidates
        # Tiers: 0: Perfect/Clean (15), 1: Moderate (25), 2: Hard (40), 3: Cut (None)
        tier_map = {}
        target_indices = []
        
        for threshold_idx, threshold in enumerate([15, 25, 40, None]):
            for i, tid in enumerate(ids):
                if tid == seed_track_id or tid in tier_map:
                    continue
                
                t_bpm = track_map[tid].get('tempo')
                if threshold is None or self.bpm_compatible(seed_bpm, t_bpm, threshold):
                    tier_map[tid] = threshold_idx
                    target_indices.append(i)
            
            # If we found at least 5 candidates in total so far across tiers
            if len(target_indices) >= limit:
                break
                
        if not target_indices:
            return []
            
        # 3. Calculate similarity
        comp_matrix = matrix[target_indices]
        similarities = cosine_similarity(seed_vector, comp_matrix)[0]
        
        # 4. Hybrid Ranking (Tier priority + Similarity fallback)
        # We want to sort primarily by tier (lower is better) and secondarily by similarity (higher is better)
        # Final Score = (3 - Tier) + Similarity  (Since similarity is 0-1, this preserves tier order)
        hybrid_scores = []
        for idx, similarity in enumerate(similarities):
            tid = ids[target_indices[idx]]
            tier = tier_map[tid]
            # Each tier gets a +1.0 boost, ensuring Tier 0 beats Tier 1 even if similarity is 0.0 vs 1.0
            hybrid_score = (3 - tier) + similarity
            hybrid_scores.append(hybrid_score)
            
        # 5. Sort and map back
        ranked_indices = np.argsort(hybrid_scores)[::-1][:limit]
        
        recs = []
        # Debug printing can crash the endpoint on Windows consoles with non-CP1252 characters.
        # Keep logs safe so the frontend can still function.
        def _safe_debug(msg: str) -> None:
            # Force an ASCII-safe representation so Windows console encoding
            # never throws (prevents 500s from debug logging).
            safe = msg.encode('ascii', 'backslashreplace').decode('ascii')
            print(safe)

        _safe_debug(f"DEBUG: BPM Tiers logic - Seed BPM: {seed_bpm}")
        _safe_debug(f"DEBUG: Pool found: {len(target_indices)} candidates")

        for r_idx in ranked_indices:
            original_idx = target_indices[r_idx]
            tid = ids[original_idx]
            recs.append(track_map[tid])
            
        if recs:
            _safe_debug(
                f"DEBUG: Top pick: {recs[0]['title']}, BPM: {recs[0].get('tempo')} "
                f"(Tier {tier_map[recs[0]['id']]})"
            )
             
        return recs

    @Slot(result=list)
    def generate_recommendations(self, count=20, epsilon=0.3, user_id=None):
        """
        Generates mixed recommendations.
        If history exists (filtered by user_id), uses last played track as seed.
        Otherwise falls back to random/popular.
        """
        history = self.db.get_listening_history(limit=1, user_id=user_id)
        seed_track = None
        
        if history:
            last_played = history[0]
            # Verify we have features for this track
            # (In MVP, just try to use it)
            seed_track = last_played['track_id']
            
        recs = []
        
        # 1. Similarity (Exploitation)
        if seed_track and random.random() > epsilon:
            similar = self.find_similar_tracks(seed_track, limit=count)
            recs.extend(similar)
            
        # 2. Fill remainder with weighted random (Exploration)
        needed = count - len(recs)
        if needed > 0:
            all_tracks = self.db.get_all_tracks()
            # Filter out ones already in recs
            existing_ids = set(r['id'] for r in recs)
            pool = [dict(t) for t in all_tracks if t['id'] not in existing_ids]
            
            if pool:
                # Weighted by play count (simple additive smoothing)
                # weights = [t['play_count'] + 1 for t in pool]
                # recs.extend(random.choices(pool, weights=weights, k=min(needed, len(pool))))
                # Just random for now to ensure diversity
                random.shuffle(pool)
                recs.extend(pool[:needed])

        return recs
