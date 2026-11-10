# Analyse précise des circuits (parcours officiels)

Outil qui produit les parcours de drift officiels livrés avec le launcher
(`src/main/telemetry/courses/*.json`, `analysis: 2`), à partir des fichiers du circuit lui-même.

Pour chaque tracé :

1. **Surface valide** : les objets physiques du circuit dont la surface est « piste valide »
   (`data/surfaces.ini`, `IS_VALID_TRACK=1`) sont dessinés à 10 cm près ; les murs coupent la surface.
2. **Limites de piste** : le contour exact de cette surface autour du parcours (carrefours, aires et
   îlots compris), simplifié à 6 cm.
3. **Clips** : chaque clip ponctuel est recalé sur le centre du marquage peint au sol qui est dessous
   (peinture, cadres, losanges…) ; les zones suivent les bandes peintes.
4. **Ligne de référence** : elle ne dépend que des clips : la courbe la plus fluide (courbure et
   variation de courbure minimales) qui passe par le début du drift, chaque clip dans l'ordre (centre
   d'un clip, milieu de la bande d'une zone) et l'arrivée. La piste n'intervient que là où la courbe en
   sortirait : elle est alors repoussée à 60 cm du bord. Les murs à plus de 2 m au-dessus de la route
   (un pont) ne comptent pas. `LKS_LINE=road` reprend l'ancienne méthode, le long de la route.
5. **Départ, début du drift, arrivée** : repris des lignes peintes et panneaux du circuit (gardés tels
   quels) ; la ligne commence et finit exactement en les traversant.

Contrôles affichés à chaque analyse : écart clip / marquage, distance ligne / clip et ligne / axe de
chaque zone, rayon de courbure minimum de la ligne. Une image de contrôle par tracé
(`out/<tracé>.png`) montre la piste, les limites, les marquages, les clips, la ligne et une voiture
à l'endroit où elle prend chaque clip.

## Utilisation

```bash
pip install numpy pillow scipy scikit-image osqp
python3 fetch.py                    # télécharge les modèles et lignes IA des circuits du groupe (sans textures)
python3 run.py cha,cro              # analyse + images de contrôle
python3 run.py cha --export         # écrit aussi le parcours officiel
```

Les tracés connus et le repérage de la peinture de chacun sont dans `analysis.py` (`LAYOUTS`, `PAINT`).
Un nouveau circuit : ajouter son tracé, lancer `survey` (les objets sous chaque clip) pour trouver
le nom ou la matière de sa peinture, puis `run.py`.
