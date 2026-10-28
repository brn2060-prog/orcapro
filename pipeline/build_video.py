"""
Monta o episodio: imagens com Ken Burns + mapas animados + narracao por cena.
Uso: python pipeline/build_video.py 01-vikings-arctic-winter [--fps 30] [--preview]
Saidas em episodes/<slug>/out/: <slug>_full.mp4, timeline.json, description.txt
Imagens ausentes viram cartoes-placeholder com o prompt (bom para revisar o corte antes de gastar credito).
"""
import argparse, json, shutil, subprocess, sys, textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_script, ep_dir, scene_duration, fill_prompt, media_duration, EPISODES

W, H = 1920, 1080
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"

def placeholder(path, caption, label, prompt):
    img = Image.new("RGB", (W, H), "#1d2b36")
    d = ImageDraw.Draw(img)
    for y in range(H):  # gradiente frio -> quente
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(29 + 60 * t), int(43 + 40 * t), int(54 + 10 * t)))
    glow = Image.new("RGB", (W, H), "black"); gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.3, H * 0.45, W * 0.7, H * 1.1], fill=(190, 110, 50))
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    img = Image.blend(img, Image.composite(glow, img, glow.convert("L")), 0.55)
    d = ImageDraw.Draw(img)
    f_big = ImageFont.truetype(FONT_B, 64); f_sm = ImageFont.truetype(FONT_R, 30); f_tag = ImageFont.truetype(FONT_B, 26)
    d.text((80, 60), label, font=f_tag, fill="#e0a94a")
    if caption:
        d.text((80, 110), caption, font=f_big, fill="#f5ecd7")
    y = 260
    for line in textwrap.wrap(prompt, 90)[:9]:
        d.text((80, y), line, font=f_sm, fill="#d9c7a0"); y += 42
    img.save(path)

def caption_filter(text):
    if not text:
        return ""
    safe = text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")
    return (f",drawtext=fontfile={FONT_B}:text='{safe}':fontsize=46:fontcolor=#f5ecd7:"
            f"borderw=3:bordercolor=#0b1218:x=80:y=h-150:"
            f"alpha='if(lt(t,0.6),t/0.6,if(lt(t,4.5),1,if(lt(t,5.1),(5.1-t)/0.6,0)))'")

KB = [  # variacoes de Ken Burns (zoom in / out, pan esquerda / direita)
    "z='1+0.12*on/{N}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'",
    "z='1.12-0.12*on/{N}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'",
    "z='1.08+0.06*on/{N}':x='(iw-iw/zoom)*on/{N}':y='(ih-ih/zoom)/2'",
    "z='1.08+0.06*on/{N}':x='(iw-iw/zoom)*(1-on/{N})':y='(ih-ih/zoom)*0.3'",
]

def image_clip(img, dur, fps, caption, variant, dst):
    N = max(int(dur * fps), 2)
    kb = KB[variant % len(KB)].format(N=N)
    vf = (f"scale=2880:1620:force_original_aspect_ratio=increase,crop=2880:1620,"
          f"zoompan={kb}:d=1:s={W}x{H}:fps={fps},format=yuv420p{caption_filter(caption)}")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", str(fps), "-i", str(img),
                    "-t", f"{dur:.3f}", "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", str(dst)], check=True)

def with_audio(video, audio, dur, dst):
    if audio and audio.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-i", str(audio),
                        "-filter_complex", "[1:a]apad[a]", "-map", "0:v", "-map", "[a]",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", f"{dur:.3f}", "-shortest", str(dst)], check=True)
    else:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                        "-t", f"{dur:.3f}", "-shortest", str(dst)], check=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--scenes", default="", help="ex.: 1-6 (so um trecho, para testar)")
    a = ap.parse_args()
    data = load_script(a.slug)
    ep = EPISODES / a.slug
    out = ep_dir(a.slug, "out"); tmp = ep_dir(a.slug, "out", "clips")
    sel = None
    if a.scenes:
        lo, hi = (a.scenes.split("-") + [a.scenes])[:2]; sel = range(int(lo), int(hi) + 1)
    timeline, parts, t0, variant = [], [], 0.0, 0
    for sc in data["scenes"]:
        if sel and sc["id"] not in sel:
            continue
        dur = scene_duration(a.slug, sc)
        audio = ep / "audio" / f"scene_{sc['id']:02d}.mp3"
        clip_v = tmp / f"v_{sc['id']:02d}.mp4"
        if "map" in sc:
            src = ep / "maps" / f"scene_{sc['id']:02d}.mp4"
            if not src.exists() or abs(media_duration(src) - dur) > 0.5:
                sys.exit(f"Mapa da cena {sc['id']} ausente ou com duracao errada. Rode: python pipeline/render_maps.py {a.slug}")
            shutil.copy(src, clip_v)
        else:
            imgs = sc.get("images", [])
            n = max(len(imgs), 1); each = dur / n; subs = []
            for i in range(1, n + 1):
                img = ep / "images" / f"scene_{sc['id']:02d}_{i}.png"
                if not img.exists():
                    img = tmp / f"ph_{sc['id']:02d}_{i}.png"
                    prompt = fill_prompt(imgs[i - 1], data["style"]) if imgs else ""
                    placeholder(img, sc.get("on_screen", ""), f"PLACEHOLDER  scene {sc['id']:02d}  image {i}/{n}", prompt)
                sub = tmp / f"v_{sc['id']:02d}_{i}.mp4"
                image_clip(img, each, a.fps, sc.get("on_screen", "") if i == 1 else "", variant, sub)
                variant += 1; subs.append(sub)
            if len(subs) == 1:
                shutil.copy(subs[0], clip_v)
            else:
                lst = tmp / f"l_{sc['id']:02d}.txt"
                lst.write_text("".join(f"file '{s.name}'\n" for s in subs))
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                                "-c", "copy", str(clip_v)], check=True)
        clip = tmp / f"c_{sc['id']:02d}.mp4"
        with_audio(clip_v, audio, dur, clip)
        timeline.append({"id": sc["id"], "type": sc["type"], "start": round(t0, 2), "duration": round(dur, 2),
                         "on_screen": sc.get("on_screen", ""), "has_audio": audio.exists()})
        parts.append(clip); t0 += dur
        print(f"scene {sc['id']:02d} {sc['type']:<12} {dur:5.1f}s  total {t0/60:5.2f} min")

    lst = tmp / "all.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in parts))
    final = out / f"{a.slug}{'_part' if sel else ''}_full.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(final)], check=True)
    (out / "timeline.json").write_text(json.dumps(timeline, indent=2))

    # descricao com capitulos + fontes
    chapters = [f"{int(t['start']//60):02d}:{int(t['start']%60):02d} {t['on_screen']}" for t in timeline if t["on_screen"]]
    desc = data["description"] + "\n\nChapters\n" + "\n".join(chapters) + "\n\nSources\n" + "\n".join("- " + s for s in data["sources"])
    desc += "\n\nNarration and illustrations produced with AI tools under human research and editing. Maps rendered from Natural Earth data.\n\n" + " ".join("#" + t.replace(" ", "") for t in data["tags"])
    (out / "description.txt").write_text(desc, encoding="utf-8")
    print(f"\nOK -> {final}  ({t0/60:.1f} min)")

if __name__ == "__main__":
    main()
