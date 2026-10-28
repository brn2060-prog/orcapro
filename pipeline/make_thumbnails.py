"""
Gera 3 thumbnails com composicoes DIFERENTES (regra anti-template).
Uso: python pipeline/make_thumbnails.py 01-vikings-arctic-winter --scenes 13,1,25 --texts "NO CHIMNEY?|7 WEEKS OF NIGHT|80% SEAL"
Usa images/scene_XX_1.png (ou o placeholder) como fundo.
"""
import argparse, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import EPISODES, ep_dir
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
W, H = 1280, 720

def base(ep, sid):
    for cand in (ep / "images" / f"scene_{sid:02d}_1.png", ep / "out" / "clips" / f"ph_{sid:02d}_1.png"):
        if cand.exists():
            im = Image.open(cand).convert("RGB")
            im = im.resize((W, int(W * im.height / im.width)))
            im = im.crop((0, (im.height - H) // 2, W, (im.height - H) // 2 + H))
            return ImageEnhance.Contrast(im).enhance(1.15)
    return Image.new("RGB", (W, H), "#1d2b36")

def layout_a(im, text):  # texto grande em baixo, faixa escura
    d = ImageDraw.Draw(im, "RGBA"); d.rectangle([0, H * 0.62, W, H], fill=(11, 18, 24, 170))
    f = ImageFont.truetype(FONT_B, 110); d.text((50, H * 0.66), text, font=f, fill="#f5ecd7", stroke_width=5, stroke_fill="#0b1218")
    return im

def layout_b(im, text):  # bloco laranja lateral esquerdo, texto empilhado
    d = ImageDraw.Draw(im, "RGBA"); d.rectangle([0, 0, W * 0.45, H], fill=(192, 85, 42, 215))
    f = ImageFont.truetype(FONT_B, 96); y = 90
    for w in text.split():
        d.text((50, y), w, font=f, fill="#f5ecd7"); y += 115
    return im

def layout_c(im, text):  # texto centralizado com vinheta, dourado
    vig = Image.new("L", (W, H), 0); ImageDraw.Draw(vig).ellipse([-200, -200, W + 200, H + 200], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(200))
    im = Image.composite(im, Image.new("RGB", (W, H), "#0b1218"), vig)
    d = ImageDraw.Draw(im); f = ImageFont.truetype(FONT_B, 120)
    tw = d.textlength(text, font=f); d.text(((W - tw) / 2, H * 0.36), text, font=f, fill="#e0a94a", stroke_width=6, stroke_fill="#0b1218")
    return im

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("--scenes", required=True); ap.add_argument("--texts", required=True)
    a = ap.parse_args()
    ep = EPISODES / a.slug; out = ep_dir(a.slug, "out")
    for i, (sid, text, lay) in enumerate(zip(a.scenes.split(","), a.texts.split("|"), (layout_a, layout_b, layout_c)), 1):
        im = lay(base(ep, int(sid)), text.strip())
        dst = out / f"thumb_{i}.jpg"; im.save(dst, quality=92); print("ok", dst)

if __name__ == "__main__":
    main()
