# Valorant Short Maker

Génère automatiquement des courts métrages type TikTok/Reel avec des agents Valorant, sous-titres karaoké, transition fisheye, et musique de fond.

## Prérequis

- [Bun](https://bun.sh) ≥ 1.3
- FFmpeg 7.0+ (inclus dans `bin/ffmpeg/`)
- Modèles TTS Piper (dans `voices/`)

## Installation

```bash
bun install
```

Les voix Piper sont pré-installées dans `voices/` (un dossier par agent avec un fichier `.onnx` et sa config).

## Utilisation

### Script de démonstration

Éditez `demo_script.txt` avec vos répliques :

```
agent: Votre texte ici
```

Syntaxe :
- `agent: texte` — une réplique prononcée par cet agent
- `pause: 1.0` — une pause de N secondes (agent muet, cercle affiché)
- `[0.3]` dans le texte — silence de N secondes inséré dans le WAV

Agents disponibles (26) : `omen`, `jett`, `phoenix`, `brimstone`, `sage`, `raze`, `killjoy`, `cypher`, `viper`, etc.

Lancez la génération :

```bash
bun run src/demo.ts
```

Le rendu final est dans `demo_outputs/demo.mp4`.

[Voir la video de demo](https://github.com/fox3000foxy/valorant-short-maker/blob/main/demo_outputs/demo.mp4)

## Fonctionnement

### Pipeline

1. **Parsing** — `demo_script.txt` est lu et découpé en répliques
2. **TTS** — Chaque texte est synthétisé via [Piper](https://github.com/rhasspy/piper) avec la voix de l'agent
3. **Sous-titres** — Un fichier ASS est généré avec du karaoké : les mots s'illuminent au fur et à mesure
4. **Rendu vidéo** — Chaque segment est rendu individuellement :
   - Fond : extrait de `bg-video/clip_005_new_audio.mp4` ajusté à la durée
   - Cercle : icône de l'agent qui zoome/dézoom au rythme de la voix
   - Sous-titres : incrustés via le filtre `ass` d'FFmpeg
   - Audio : TTS + son du gameplay mixés
5. **Transition** — Le premier segment reçoit un fisheye progressif + whoosh
6. **Concaténation** — Tous les segments sont concaténés, la musique de fond est mixée

### Points clés

- **60 fps** partout (vidéo, cercle, timeline)
- **Fisheye progressif** : distorsion qui disparaît sur les 20% premiers frames (per-frame `lenscorrection` + `tmix=frames=3` pour le motion blur)
- **Cercle audio-réactif** : l'enveloppe RMS du WAV pilote l'échelle du cercle (via `computeScaleExpr`)
- **Musique de fond** : Sneaky Snitch — Kevin MacLeod (incluse dans `bg-video/background_music.mp3`)

### FPS & Qualité

Paramètres dans `src/demo.ts` :
- `FPS = 60`
- `MAX_ZOOM_VARIATION = 0.2` (amplitude du zoom du cercle)
- `STEP = 4` (groupes de frames pour l'expression d'échelle)

### Architecture des fichiers

```
├── src/
│   ├── demo.ts        # Orchestrateur principal + rendu
│   ├── tts.ts         # Interface Piper TTS
│   ├── subtitle.ts    # Génération ASS karaoké
│   ├── workflow.ts    # Pipeline alternatif (--demo)
│   ├── index.ts       # (vide)
│   ├── agent-chat.ts  # Chat LLM (expérimental)
│   ├── lines.ts       # Génération de lignes (expérimental)
│   └── lore/          # Personnalités des agents
├── voices/            # Modèles TTS (26 agents)
├── icons/             # Icônes rondes des agents
├── sounds/            # whoosh.mp3
├── bg-video/          # Boucle vidéo de fond + musique
├── bin/ffmpeg/        # FFmpeg 7.0.2 static
└── demo_script.txt    # Script de démo
```

## Licence personnalisée

Projet privé. Les voix et icônes appartiennent à Riot Games (Valorant). La musique est Sneaky Snitch — Kevin MacLeod (Creative Commons).
