Les sous titres vont fonctionner dans le styke Karaoke qu'on peut retrouver sur https://github.com/nicolaigaina/ai-video-captions

En gros, le style Karaoke permet de mettre en évidence les mots au fur et à mesure qu'ils sont prononcés dans la vidéo, ce qui rend l'expérience de visionnage plus interactive et engageante. Cela peut être particulièrement utile pour les vidéos éducatives, les tutoriels ou les vidéos musicales où le timing des paroles est important.

Ici on veut synchroniser les sous-titres avec l'audio de la vidéo pour que les mots apparaissent exactement au moment où ils sont prononcés. Pour ce faire, il est nécessaire d'utiliser un format de sous-titres qui supporte le timing précis, comme le format SRT ou WebVTT.

Il faudra également que la couleur match la couleur des cercles des icones des agents Valorant pour que l'esthétique soit cohérente avec le thème du jeu. Cela peut être fait en ajustant les styles CSS des sous-titres pour correspondre aux couleurs spécifiques des agents. Ca serait plus cohérent d'afficher le cercle qui parle en zoomant et dézoomant légèrement le cercle de l'agent qui parle, pour attirer l'attention sur lui et renforcer l'effet de synchronisation entre l'audio et les sous-titres.

Pour les tests on peut prendre un fond 9:16 noir, et générer la phrase "This video is a test of subtitle" parlé par Raze, puis "We can switch between agents" parlé par Jett, et enfin "Let's see how it works" parlé par Phoenix. Chaque phrase sera synchronisée avec l'audio correspondant et les sous-titres apparaîtront en temps réel avec les paroles.

On affichera le cercle de l'agent qui parle en haut de l'écran, et les sous-titres en bas, pour que l'utilisateur puisse facilement suivre qui parle et ce qui est dit. Le cercle de l'agent qui parle sera mis en évidence avec un léger zoom dézoom qui s'adapte par rapport à l'audio pour attirer l'attention sur lui. Le mot prononcé sera alors mis en couleur par rapport à la couleur du contour du cercle de l'agent qui parle, pour renforcer l'effet de synchronisation entre l'audio et les sous-titres.
Autrement les mots pas encore prononcés seront affichés en blanc avec le contour de la couleur de l'agent pour indiquer qu'ils ne sont pas encore prononcés.
Pour rappel la couleur est le dégradé présent sur le cercle de l'agent, et non pas la couleur de l'agent lui même. Par exemple pour Raze, le dégradé est du orange-jaune-orange, pour Jett c'est du bleu clair au bleu foncé, et pour Phoenix c'est du orange au rouge. Analyser les images pour trouver les dégradés exacts et les utiliser pour les sous-titres afin de maintenir la cohérence visuelle avec le thème du jeu. Aussi la font name est Montserrat.

On est sur ce layout a peu près:

+------------------------+
|                        |
|          ___           |
|        /     \         |
|       |   @   |        |
|        \_____/         |
|                        |
|                        |
|                        |
|                        |
|                        |
|    Subs are here !     |
|                        |
|                        |
|                        |
|                        |
+------------------------+