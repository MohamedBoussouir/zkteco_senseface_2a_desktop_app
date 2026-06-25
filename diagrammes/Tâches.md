# Tâches - Application Desktop ZKTeco (ADMS)

## 1. Gestion des appareils ZKTeco
- Ajouter un appareil (SN, IP, Port)
- Scanner les appareils sur le réseau (ADMS Discovery)
- Tester la connexion à un appareil
- Supprimer un appareil
- Afficher le statut de connexion

## 2. Gestion des employés (CRUD)
- Créer un employé avec ID, nom, mot de passe, carte
- Modifier les informations d'un employé
- Supprimer un employé
- Synchroniser les employés depuis l'appareil ZKTeco

## 3. Gestion des données biométriques
- Enrôler les empreintes digitales (10 doigts)
- Supprimer une empreinte spécifique
- Supprimer toutes les empreintes
- Uploader une photo de visage (webcam ou fichier)
- Supprimer la photo/visage

## 4. Gestion des identifiants
- Mettre à jour le mot de passe et le numéro de carte

## 5. Synchronisation des pointages (Logs)
- Synchroniser les logs depuis l'appareil via ADMS
- Filtrer et rechercher les pointages
- Supprimer un pointage
- Effacer tous les pointages

## 6. Gestion des plannings
- Créer/Modifier/Supprimer des shifts (postes : nom, heure début, heure fin)
- Créer/Modifier/Supprimer des Work Patterns (patterns hebdomadaires)
- Créer/Modifier/Supprimer des Schedules (plannings quotidiens)
- Assigner un pattern à un employé

## 7. Rapports de présence
- Générer le rapport de retard (Journalier / Mensuel / Annuel / Personnalisé)
- Exporter le rapport en PDF
- Exporter le rapport en Excel
- Calcul automatique des heures travaillées et minutes de retard

## 8. Tableau de bord
- Afficher les statistiques locales (nombre employés, appareils, logs aujourd'hui)
- Afficher les statistiques live des appareils
- Graphique d'évolution des pointages sur 7 jours
- Dernières activités

## 9. Paramètres
- Configurer le port ADMS
- Synchroniser l'heure des appareils
- Configurer le mode de calcul des pointages (Smart/Manuel)
- Définir le shift par défaut
- Changer la langue (Anglais / Français)

## 10. Maintenance des appareils
- Redémarrer tous les appareils
- Effacer les logs des appareils
- Définir une heure personnalisée sur les appareils

## 11. Gestion de la licence
- Vérifier la licence au démarrage
- Activer la licence (clé de cryptage AES-256-GCM)
- Lier la licence à l'ID machine
- Détection de fraude d'horloge

## 12. Communication ADMS (Serveur HTTP)
- Démarrer le serveur HTTP ADMS (port configurable)
- Gérer le handshake des appareils (GET /iclock/cdata)
- Recevoir les données de pointage (POST /iclock/cdata)
- Transmettre les commandes aux appareils (GET /iclock/getrequest)
- Recevoir les résultats des commandes (POST /iclock/devicecmd)

## 13. Synchronisation automatique (Scheduler)
- Synchronisation périodique toutes les 30 minutes
- Synchronisation des utilisateurs et des logs en arrière-plan
