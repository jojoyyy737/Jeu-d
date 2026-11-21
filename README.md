# Les Dés — MVP multijoueur

Jeu de dés mobile-first pour 2 à 5 joueurs, avec salles par code, serveur autoritaire, lancer sécurisé côté serveur avec `crypto.randomInt`, tours, Million, égalité et option Abattage.

## Lancer en local

```bash
npm install
npm start
```

Ouvrir `http://localhost:10000` dans deux onglets ou deux téléphones sur le même réseau.

## Déployer sur Render

1. Pousser ce dépôt sur GitHub.
2. Dans Render, choisir **New > Web Service** puis le dépôt.
3. Build command : `npm install`.
4. Start command : `npm start`.
5. Health check : `/health`.
6. Choisir le plan Free.

Le MVP stocke les salles en mémoire. Un redémarrage du service ferme les tables ouvertes. La prochaine version devra ajouter PostgreSQL, comptes, portefeuille, journal de transactions et reprise de connexion.
