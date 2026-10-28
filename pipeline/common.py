import json, os, subprocess, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EPISODES = ROOT / "episodes"

def load_script(slug):
    return json.loads((EPISODES / slug / "script.json").read_text(encoding="utf-8"))

def save_script(slug, data):
    (EPISODES / slug / "script.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

def ep_dir(slug, *sub):
    p = EPISODES / slug
    for s in sub:
        p = p / s
    p.mkdir(parents=True, exist_ok=True)
    return p

def media_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                         capture_output=True, text=True).stdout.strip()
    return float(out) if out else 0.0

def estimate_duration(text, wpm=140):
    """Duracao estimada da narracao quando ainda nao ha audio."""
    words = len(text.split())
    return round(words / wpm * 60 + 0.6, 2)

def scene_duration(slug, scene):
    """Duracao real (audio da cena) ou estimada."""
    audio = EPISODES / slug / "audio" / f"scene_{scene['id']:02d}.mp3"
    if audio.exists():
        return media_duration(audio) + 0.4
    return estimate_duration(scene["narration"])

def fill_prompt(prompt, style):
    return prompt.replace("{style}", style["visual"]).replace("{guide}", style["guide_character"])

def run(cmd):
    subprocess.run(cmd, check=True)
