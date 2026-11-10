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
4. **Ligne de référence** : elle passe par chaque clip (centre d'un clip ponctuel, milieu de la bande
   d'une zone, à 15 cm près), la plus fluide possible (courbure et variation de courbure minimales),
   à au moins 50 cm des limites ; les entrées de carrefour et routes latérales ne comptent pas comme de
   la place pour elle.
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
