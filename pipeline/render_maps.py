"""
Renderiza todas as cenas de mapa do episodio com a duracao da narracao.
Uso: python pipeline/render_maps.py 01-vikings-arctic-winter [--only 2,3] [--fps 30]
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import load_script, ep_dir, scene_duration
from mapengine.maps import render_scene

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug"); ap.add_argument("--only", default=""); ap.add_argument("--fps", type=int, default=30)
    a = ap.parse_args()
    data = load_script(a.slug)
    out = ep_dir(a.slug, "maps")
    only = {int(x) for x in a.only.split(",") if x}
    for sc in data["scenes"]:
        if "map" not in sc or (only and sc["id"] not in only):
            continue
        dur = scene_duration(a.slug, sc)
        dst = out / f"scene_{sc['id']:02d}.mp4"
        render_scene(sc["map"], str(dst), duration=dur, fps=a.fps)
        print(f"ok scene {sc['id']:02d} {sc['map']['kind']} {dur:.1f}s")

if __name__ == "__main__":
    main()
