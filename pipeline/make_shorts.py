"""
Corta um Short 9:16 (max 60 s) a partir do episodio montado.
Uso: python pipeline/make_shorts.py 01-vikings-arctic-winter --scenes 13-15 --title "Viking halls had NO chimney"
Usa out/timeline.json para achar os tempos das cenas.
"""
import argparse, json, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import EPISODES, ep_dir
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("--scenes", required=True); ap.add_argument("--title", default="")
    ap.add_argument("--max", type=float, default=59.5)
    a = ap.parse_args()
    ep = EPISODES / a.slug
    tl = json.loads((ep / "out" / "timeline.json").read_text())
    lo, hi = [int(x) for x in a.scenes.split("-")]
    sel = [t for t in tl if lo <= t["id"] <= hi]
    start = sel[0]["start"]; dur = min(sum(t["duration"] for t in sel), a.max)
    src = ep / "out" / f"{a.slug}_full.mp4"
    dst = ep_dir(a.slug, "out") / f"short_{lo:02d}-{hi:02d}.mp4"
    title = a.title.replace("'", "’").replace(":", "\\:")
    vf = ("crop=ih*9/16:ih,scale=1080:1920,"
          f"drawtext=fontfile={FONT_B}:text='{title}':fontsize=64:fontcolor=#f5ecd7:borderw=4:bordercolor=#0b1218:"
          "x=(w-text_w)/2:y=180:line_spacing=10," if title else "crop=ih*9/16:ih,scale=1080:1920,")
    vf += "fade=t=out:st=%.2f:d=0.5" % (dur - 0.5)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-t", f"{dur:.2f}", "-i", str(src),
                    "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
                    "-movflags", "+faststart", str(dst)], check=True)
    print(f"OK -> {dst} ({dur:.1f}s)  Legenda sugerida: '{a.title}' + link do video completo nos comentarios")

if __name__ == "__main__":
    main()
