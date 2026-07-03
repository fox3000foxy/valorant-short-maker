# Valorant Short Maker

Génère automatiquement des courts métrages type TikTok/Reel avec des agents Valorant, sous-titres karaoké, transition fisheye, et musique de fond.

## Prérequis

- [Bun](https://bun.sh) ≥ 1.3
- FFmpeg 7.0+ (inclus dans `bin/ffmpeg/`)
- Modèles TTS Piper (dans `voices/`)
- Clé API Groq pour la génération LLM (`GROQ_API_KEY` dans `.env`)

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

### Workflow (génération LLM)

Génère un script humoristique entre 3-4 agents Valorant via Groq/Llama, choisit un clip de fond aléatoire et produit la vidéo.

```bash
bun run src/workflow.ts --context "un combat sur le site B"
```

Résultat dans `workflow_outputs/<session_id>/` :
```
workflow_outputs/<session_id>/
├── assets/          # fichiers intermédiaires (TTS, ASS, segments vidéo)
│   ├── 0_omen.wav
│   ├── 0_omen.ass
│   ├── 0_omen.mp4
│   ├── 00_intro.mp4   # segment avec transition fisheye
│   └── ...
├── script.txt       # le script généré (réutilisable dans demo_script.txt)
└── output.mp4       # vidéo finale
```

Options :
- `--context "texte"` — thème ou situation (plus c'est drôle, mieux c'est)
- `--demo` — utilise le script de `demo_script.txt` au lieu de générer
- `--output <dossier>` — dossier de sortie (défaut : `workflow_outputs/`)
- `--parts <N>` — découpe en N parties

Pour un résultat humoristique, soyez créatif dans le contexte :

```bash
bun run src/workflow.ts --context "un Phoenix qui se vante puis se fait one-tap, les autres agents se moquent de lui"
```

[Voir la video de demo](https://github.com/fox3000foxy/valorant-short-maker/blob/main/demo_outputs/demo.mp4)

## Fonctionnement

### Pipeline

1. **Parsing** — Le script (fichier ou LLM) est découpé en répliques
2. **TTS** — Chaque texte est synthétisé via [Piper](https://github.com/rhasspy/piper) avec la voix de l'agent
3. **Sous-titres** — Un fichier ASS est généré avec du karaoké : les mots s'illuminent au fur et à mesure
4. **Rendu vidéo** — Chaque segment est rendu individuellement :
   - Fond : extrait de `bg-video/` ajusté à la durée
   - Cercle : icône de l'agent qui zoome/dézoom au rythme de la voix
   - Sous-titres : incrustés via le filtre `ass` d'FFmpeg
   - Audio : TTS + son du gameplay mixés
5. **Transition** — Le premier segment reçoit un fisheye progressif + whoosh
6. **Concaténation** — Tous les segments sont concaténés, la musique de fond est mixée

### Points clés

- **60 fps** partout (vidéo, cercle, timeline)
- **Fisheye progressif** : distorsion qui disparaît sur les 20% premiers frames (per-frame `lenscorrection` + `tmix=frames=3` pour le motion blur)
- **Cercle audio-réactif** : l'enveloppe RMS du WAV pilote l'échelle du cercle (via `computeScaleExpr`)
- **Audio ducking** : la musique de fond baisse automatiquement pendant les répliques (sidechain compression)
- **Musique de fond** : Sneaky Snitch — Kevin MacLeod (incluse dans `bg-video/background_music.mp3`)
- **Workflow LLM** : génération de scripts via `--context` (Groq + Llama 3.3)
- **Clip aléatoire** : sélection d'un fond différent à chaque run

### Paramètres

Dans `src/core.ts` :
- `FPS = 60`
- `MAX_ZOOM_VARIATION = 0.2` (amplitude du zoom du cercle)
- `STEP = 8` (groupes de frames pour l'expression d'échelle, limite la profondeur des `if()` imbriqués)

### Architecture des fichiers

```
├── src/
│   ├── core.ts        # Moteur partagé : TTS, rendu, concat, fisheye
│   ├── demo.ts        # Script de démo (importe core.ts)
│   ├── workflow.ts    # Pipeline LLM (importe core.ts)
│   ├── tts.ts         # Interface Piper TTS
│   ├── subtitle.ts    # Génération ASS karaoké
│   ├── agent-chat.ts  # Client Groq pour génération LLM
│   └── lore/          # Personnalités des agents (omen, jett, phoenix)
├── voices/            # Modèles TTS (26 agents)
├── icons/             # Icônes rondes des agents
├── sounds/            # whoosh.mp3
├── bg-video/          # Boucles vidéo de fond + musique
├── bin/ffmpeg/        # FFmpeg 7.0.2 static
├── demo_script.txt    # Script de démonstration
├── demo_outputs/      # Sortie de bun run src/demo.ts
└── workflow_outputs/  # Sortie de bun run src/workflow.ts (gitignoré)
```

## Licence personnalisée

Projet privé. Les voix et icônes appartiennent à Riot Games (Valorant). La musique est Sneaky Snitch — Kevin MacLeod (Creative Commons).
