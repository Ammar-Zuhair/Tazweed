"""Tazweed intro v2: whole-content spring emergence + independent rotating tire.
Requires ffmpeg with SVG/librsvg decoding, no Python imaging libraries or API.
"""
from pathlib import Path
import subprocess
here=Path(__file__).resolve().parent
for theme in ('light','dark'):
 graph=(here/f'composition-{theme}.ffgraph').read_text()
 command=['ffmpeg','-hide_banner','-loglevel','error','-y','-filter_complex_threads','2']
 for asset in ['tire-ring.png','logo-content.png',f'background-{theme}.svg','energy-arcs.svg']:
  command+=['-loop','1','-framerate','30','-i',str(here/'layers'/asset)]
 command+=['-i',str(here/'tazweed-sonic-logo.wav'),'-filter_complex',graph,
  '-map','[out]','-map','4:a','-t','4','-r','30',
  '-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p',
  '-c:a','aac','-b:a','160k','-movflags','+faststart',str(here.parent/'video'/f'intro-{theme}.mp4')]
 subprocess.run(command,check=True)
 print(theme,'v2 rebuilt',flush=True)
