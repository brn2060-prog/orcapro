# Survival Atlas

Canal de YouTube em ingles: documentarios ilustrados sobre como as pessoas viviam e sobreviviam no passado, com mapas animados gerados por codigo.

Pipeline 100% em Python + ffmpeg. Imagens vem da Magnific (pelo Estudio Bru), voz da ElevenLabs ou Magnific, mapas e montagem rodam offline.

## Fluxo de um episodio

```
1. roteiro      python pipeline/generate_script.py "How Did Medieval Cities Get Clean Water?" --slug 03-medieval-water
                (ou escreva o script.json na mao seguindo o episodio 01)
2. REVISAR      abra episodes/<slug>/script.json e confira fatos, datas, nomes e fontes
3. prompts      python pipeline/export_prompts.py <slug>        -> images/prompts.csv (gerar na Magnific)
                salve as imagens como images/scene_05_1.png, scene_05_2.png ... (16:9, >= 1920x1080)
4. voz          python pipeline/generate_voice.py <slug>        -> audio/scene_01.mp3 ... (ElevenLabs)
                ou gere no Estudio Bru e salve com esses nomes
5. mapas        python pipeline/render_maps.py <slug>           -> maps/scene_02.mp4 ... (duracao = narracao)
6. montagem     python pipeline/build_video.py <slug>           -> out/<slug>_full.mp4 + timeline.json + description.txt
7. short        python pipeline/make_shorts.py <slug> --scenes 13-14 --title "Viking halls had NO chimney"
8. thumbs       python pipeline/make_thumbnails.py <slug> --scenes 13,3,25 --texts "NO CHIMNEY?|7 WEEKS OF NIGHT|80% SEAL"
```

Sem imagens o montador usa cartoes placeholder com o prompt (serve para revisar ritmo e corte antes de gastar credito).
Sem audio ele usa duracao estimada (140 palavras/min) e sai mudo. Rode `render_maps` de novo depois de gerar a voz, porque a duracao dos mapas segue o audio.

## Variaveis de ambiente
```
ANTHROPIC_API_KEY     roteiro
ELEVENLABS_API_KEY    voz (opcional)  ELEVEN_VOICE_ID (opcional)
```

## Instalar
```
pip install -r requirements.txt     # precisa de ffmpeg no PATH
```

## Estrutura
```
mapengine/maps.py        motor de mapas (zoom, route, territory, counter, compare), projecao opcional
pipeline/                scripts do fluxo acima
prompts/format_system_prompt.md   formato do canal (usado pelo gerador de roteiro)
episodes/<slug>/         script.json, images/, audio/, maps/, out/
```

## Regras anti-desmonetizacao (YouTube "conteudo inautentico")
- Roteiro revisado por humano, fontes reais na descricao (o montador ja escreve description.txt com capitulos e fontes).
- Thumbnails com composicoes diferentes (make_thumbnails gera 3 layouts distintos).
- Variar estrutura de titulo e gancho entre episodios.
- Personagem guia original e mapas animados em todo video; movimento em toda imagem (Ken Burns automatico).
- Marcar "conteudo alterado/sintetico" no upload. 2 a 3 videos por semana, nao diario.

## Melhorias previstas
- Trocar o mapa 1:110m (Natural Earth lowres, incluso no geopandas 0.14) por 1:10m para costas mais detalhadas: baixe `ne_10m_admin_0_countries` e aponte em `mapengine/maps.py`.
- Legendas automaticas (SRT) a partir do script.json.
