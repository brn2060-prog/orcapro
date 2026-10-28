"""
Narracao por cena com ElevenLabs (1 mp3 por cena -> duracao exata na montagem).
Uso: python pipeline/generate_voice.py 01-vikings-arctic-winter [--voice VOICE_ID] [--only 3,4]
Requer ELEVENLABS_API_KEY. Sem a chave, o montador usa duracao estimada e fica mudo.
Se preferir usar a voz da Magnific pelo Estudio Bru, salve os arquivos como
episodes/<slug>/audio/scene_01.mp3, scene_02.mp3 ... e pule este script.
"""
import argparse, os, sys, time
from pathlib import Path
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import load_script, ep_dir

API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"

def tts(text, voice, key, model="eleven_multilingual_v2"):
    import json
    body = json.dumps({"text": text, "model_id": model,
                       "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15}}).encode()
    req = urllib.request.Request(API.format(voice=voice), data=body, method="POST",
                                 headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--voice", default=os.environ.get("ELEVEN_VOICE_ID", "pNInz6obpgDQGcFmaJgB"))  # Adam (default da ElevenLabs)
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY nao definida. Gere a voz no Estudio Bru e salve em episodes/<slug>/audio/scene_XX.mp3")
    data = load_script(a.slug)
    out = ep_dir(a.slug, "audio")
    only = {int(x) for x in a.only.split(",") if x}
    for sc in data["scenes"]:
        if only and sc["id"] not in only:
            continue
        dst = out / f"scene_{sc['id']:02d}.mp3"
        if dst.exists() and not a.force:
            continue
        dst.write_bytes(tts(sc["narration"], a.voice, key))
        print("ok", dst.name); time.sleep(0.5)

if __name__ == "__main__":
    main()
