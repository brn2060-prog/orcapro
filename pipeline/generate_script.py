"""
Gera o script.json de um episodio novo com a API da Anthropic.
Uso: python pipeline/generate_script.py "How Did Medieval Cities Get Clean Water?" --slug 03-medieval-water
Requer ANTHROPIC_API_KEY. O prompt do formato esta em prompts/format_system_prompt.md
"""
import argparse, json, os, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, save_script, ep_dir

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("title")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--model", default=os.environ.get("SA_MODEL", "claude-sonnet-5-5"))
    ap.add_argument("--notes", default="", help="observacoes livres (angulo, o que incluir/evitar)")
    a = ap.parse_args()

    import anthropic
    client = anthropic.Anthropic()
    system = (ROOT / "prompts" / "format_system_prompt.md").read_text(encoding="utf-8")
    example = (ROOT / "episodes" / "01-vikings-arctic-winter" / "script.json").read_text(encoding="utf-8")
    user = (f"Write the full script.json for the episode titled: \"{a.title}\" (slug: {a.slug}).\n"
            f"Extra notes from the producer: {a.notes or 'none'}\n\n"
            f"Follow EXACTLY the JSON schema of this reference episode (same keys, same scene types, "
            f"same map spec format). Return ONLY the JSON.\n\nREFERENCE EPISODE:\n{example}")
    msg = client.messages.create(model=a.model, max_tokens=16000, system=system,
                                 messages=[{"role": "user", "content": user}])
    text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", text, re.S)
    data = json.loads(m.group(0))
    data["slug"] = a.slug
    for sub in ("maps", "images", "audio", "out"):
        ep_dir(a.slug, sub)
    save_script(a.slug, data)
    words = sum(len(s["narration"].split()) for s in data["scenes"])
    print(f"ok: episodes/{a.slug}/script.json  ({len(data['scenes'])} scenes, ~{words} words, ~{words/140:.1f} min)")
    print("REVISE O ROTEIRO (fatos, datas, nomes) antes de gerar voz e imagens.")

if __name__ == "__main__":
    main()
