import { useSettings } from '@/contexts/SettingsContext';

export function SettingsScreen() {
  const {
    marqueeSpeed,
    setMarqueeSpeed,
    accent,
    setAccent,
    languages,
    setLanguages,
    automixEnabled,
    setAutomixEnabled,
  } = useSettings();

  const availableLanguages = ['English', 'Hindi', 'Punjabi', 'Spanish', 'Tamil', 'Telugu'];

  const toggleLanguage = (lang: string) => {
    if (languages.includes(lang)) {
      if (languages.length > 1) {
        setLanguages(languages.filter((l) => l !== lang));
      }
    } else {
      setLanguages([...languages, lang]);
    }
  };

  return (
    <div className="mx-auto min-h-[100dvh] max-w-lg px-4 pt-8">
      <h1 className="mb-6 font-headline text-lg font-extrabold uppercase tracking-tighter">Settings</h1>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <label className="block font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
            AutoMix transitions
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={automixEnabled}
            onClick={() => setAutomixEnabled(!automixEnabled)}
            className={`rounded-full px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider transition-all active:scale-95 ${
              automixEnabled
                ? 'bg-[var(--reverie-accent,#C8F23A)] text-background font-bold'
                : 'border border-border bg-surface text-onSurface hover:bg-surface2'
            }`}
          >
            {automixEnabled ? 'On' : 'Off'}
          </button>
        </div>
        <p className="font-body text-[10px] leading-relaxed text-muted">
          When enabled, tracks blend together with beat-matched crossfades and automatic next-track
          selection. When disabled, each song plays on its own and ends normally.
        </p>
      </section>

      <section className="mb-8">
        <label className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
          Title scroll speed
        </label>
        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={marqueeSpeed}
          onChange={(e) => setMarqueeSpeed(Number(e.target.value))}
          className="w-full accent-[var(--reverie-accent,#C8F23A)]"
        />
        <div className="mt-1 flex justify-between font-mono text-[9px] text-muted">
          <span>Fast</span>
          <span>{marqueeSpeed}s</span>
          <span>Slow</span>
        </div>
      </section>

      <section className="mb-8">
        <label className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
          Accent color
        </label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded-lg border border-border bg-transparent p-0 overflow-hidden"
          />
          <span className="font-mono text-xs text-muted">{accent}</span>
          <button
            type="button"
            onClick={() => setAccent('#C8F23A')}
            className="ml-auto rounded-lg border border-border bg-surface px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-onSurface transition-all hover:bg-surface2 active:scale-95"
          >
            Reset
          </button>
        </div>
      </section>

      <section className="mb-10">
        <label className="mb-2 block font-mono text-[9px] uppercase tracking-[0.2em] text-muted">
          Content Languages
        </label>
        <p className="mb-4 font-body text-[10px] leading-relaxed text-muted">
          Select preferred languages to tailor your "Quick Picks", "Trending", and "New Releases" recommendations. You must have at least one selected.
        </p>
        <div className="flex flex-wrap gap-2">
          {availableLanguages.map((lang) => {
            const isSelected = languages.includes(lang);
            return (
              <button
                key={lang}
                type="button"
                onClick={() => toggleLanguage(lang)}
                className={`rounded-full px-3 py-1.5 font-mono text-[9px] transition-colors ${
                  isSelected 
                    ? 'bg-[var(--reverie-accent,#C8F23A)] text-background font-bold' 
                    : 'border border-border bg-surface text-onSurface hover:bg-surface2'
                }`}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-16 flex flex-col items-center border-t border-border pt-12 text-center">
        <div className="mb-4 transition-all duration-700 hover:scale-105">
           <h1 className="font-headline text-3xl font-extrabold uppercase tracking-tighter text-onSurface select-none">
             Reverie
           </h1>
           <p className="font-mono text-[8px] uppercase tracking-[0.4em] text-muted -mt-1">Experience Redefined</p>
        </div>

        <div className="mt-6 mb-6">
          <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted/60 mb-2">Designed & Built by</p>
          <h2 className="font-headline text-base font-extrabold uppercase tracking-tight text-[var(--reverie-accent,#C8F23A)]">
            HPS Labs
          </h2>
        </div>

        <a
          href="https://hpslabs.netlify.app"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-2 rounded-full border border-border bg-surface px-6 py-2.5 transition-all hover:border-[var(--reverie-accent,#C8F23A)]/50 hover:bg-surface2 active:scale-95"
        >
          <span className="font-mono text-[9px] uppercase tracking-widest text-onSurface">Portfolio</span>
          <svg 
            className="h-3 w-3 text-[var(--reverie-accent,#C8F23A)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2.5" 
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <line x1="7" y1="17" x2="17" y2="7"></line>
            <polyline points="7 7 17 7 17 17"></polyline>
          </svg>
        </a>
      </section>
    </div>
  );
}
