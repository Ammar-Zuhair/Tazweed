from pathlib import Path
import numpy as np
import wave
media=Path(__file__).resolve().parent
sr=48000;ts=np.arange(sr*4)/sr;rng=np.random.default_rng(47)
audio=np.zeros_like(ts)
for start,dur,freq,amp in [(0.08,0.9,140,.13),(1.32,.65,523.25,.12),(1.49,.85,659.25,.1),(1.72,1.3,783.99,.08)]:
 z=ts-start;env=np.where((z>=0)&(z<dur),(1-np.exp(-np.maximum(z,0)*45))*np.exp(-np.maximum(z,0)*4/dur),0)
 audio+=amp*env*(np.sin(2*np.pi*freq*z)+.22*np.sin(2*np.pi*freq*2*z))
noise=rng.normal(0,1,len(ts));sm=np.convolve(noise,np.ones(17)/17,mode='same')
audio+=sm*.17*np.exp(-((ts-.42)/.23)**2)
audio*=np.minimum(1,ts/.03)*np.minimum(1,(4-ts)/.2)
audio=np.clip(audio,-.75,.75)
stereo=np.column_stack([audio,audio*.98])
with wave.open(str(media/'tazweed-sonic-logo.wav'),'wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((stereo*32767).astype('<i2').tobytes())
