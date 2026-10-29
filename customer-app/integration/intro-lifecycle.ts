type IntroPlayer = { pause: () => void; play: () => void; readonly status: string };

/** useVideoPlayer owns release(). Never touch its shared object during cleanup. */
export function createIntroLifecycle(player: IntroPlayer, onDone: () => void) {
  let active = false;
  let finished = false;
  const finish = () => {
    if (!active || finished) return;
    finished = true;
    // A native release/error may race a queued completion, skip or timeout.
    // Playback failure must still allow the user into the application.
    try { player.pause(); } catch { /* The hook still owns disposal. */ }
    onDone();
  };
  return {
    activate() { active = true; },
    deactivate() { active = false; },
    finish,
    playIfReady() {
      if (!active || finished) return;
      try { if (player.status === 'readyToPlay') player.play(); } catch { finish(); }
    },
  };
}
