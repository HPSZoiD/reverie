import librosa
import numpy as np
import json

class AudioAnalyzer:
    def __init__(self):
        pass

    def analyze_track(self, file_path):
        """
        Extracts audio features from the track.
        Returns a dict with 'tempo', 'energy', 'features_json' (list of chroma/mfcc).
        """
        try:
            # 0. Get duration to find the middle of the track
            duration = librosa.get_duration(path=file_path)
            # Analyze a 60-second chunk from the middle to avoid ambient intros/outros
            offset = max(0, (duration - 60) / 2)
            y, sr = librosa.load(file_path, offset=offset, duration=60, mono=True)
            
            if len(y) == 0:
                print(f"Analysis failed: {file_path} contains no readable audio.")
                return None
            
            # 1. Tempo (BPM)
            onset_env = librosa.onset.onset_strength(y=y, sr=sr)
            tempo, _ = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)
            
            # Ensure scalar float (librosa >= 0.10 returns 1D array)
            if isinstance(tempo, np.ndarray):
                tempo = float(tempo[0]) if tempo.size > 0 else 0.0
            else:
                tempo = float(tempo)
                
            # Standardization: 70-140 BPM range (matching AutoMix frontend)
            if tempo > 0:
                while tempo > 140:
                    tempo /= 2
                while tempo < 70:
                    tempo *= 2
                
            # 2. Energy (RMS)
            rms = librosa.feature.rms(y=y)
            energy = float(np.mean(rms))
            
            # 3. Features for Similarity (Chroma - Tonality, Spectral Centroid - Timbre)
            chroma = librosa.feature.chroma_stft(y=y, sr=sr)
            chroma_mean = np.mean(chroma, axis=1).tolist() # 12 values
            
            spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
            centroid_mean = float(np.mean(spectral_centroid))
            
            # Combine into a feature vector for storage
            # We store specific metrics for display/logic, and a vector for similarity
            feature_vector = chroma_mean + [centroid_mean] # 13 values
            
            return {
                "tempo": float(tempo),
                "energy": energy,
                "features_vector": feature_vector
            }
            
        except Exception as e:
            print(f"Analysis Failed for {file_path}: {e}")
            return None
