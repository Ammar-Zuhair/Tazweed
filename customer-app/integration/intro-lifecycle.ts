type IntroPlayer = { pause: () => void; play: () => void; readonly status: string };

/** useVideoPlayer owns release(). Never touch its shared object during cleanup. */
export function createIntroLifecycle(player: IntroPlayer, onDone: () => void, onPresented: () => void = () => {}) {
  let active = false;
  let finished = false;
  let presented = false;
  let foreground = false;
  let motionChecked = false;
  let failed = false;
  const finish = () => {
    if (!active || finished) return;
    finished = true;
    try { player.pause(); } catch { /* The hook still owns disposal. */ }
    onDone();
  };
  const playIfReady = () => {
    if (!active || finished || !foreground || !motionChecked) return;
    try {
      if (failed || player.status === 'error') finish();
      else if (player.status === 'readyToPlay') player.play();
    } catch { finish(); }
  };
  return {
    activate() { active = true; },
    deactivate() { active = false; presented = false; foreground = false; },
    finish,
    playIfReady,
    appStateChanged(state: string | null) {
      if (!active || finished) return;
      foreground = state === 'active';
      // Expo Go may report null/inactive while opening the project for the first time.
      if (!foreground) { if (presented) finish(); return; }
      if (!presented) { presented = true; onPresented(); }
      playIfReady();
    },
    reduceMotionChanged(enabled: boolean) {
      if (!active || finished) return;
      motionChecked = true;
      if (enabled) finish(); else playIfReady();
    },
    statusChanged(status: string) {
      if (!active || finished) return;
      if (status === 'error') { failed = true; if (presented) finish(); }
      else if (status === 'readyToPlay') playIfReady();
    },
  };
}
