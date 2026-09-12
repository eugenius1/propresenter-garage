// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Eusebius Ngemera

import type { Dictionary } from "./en";

/**
 * French strings.
 *
 * Typed as `Dictionary`, so any key missing from here -- or present but
 * misspelled -- is a build error rather than an English string leaking into a
 * French interface.
 *
 * Narrow no-break spaces (U+202F) sit before colons and inside guillemets,
 * as French typography requires.
 */
export const fr: Dictionary = {
  meta: {
    localeTag: "fr",
    name: "Français",
    quoteOpen: "\u00ab\u202f",
    quoteClose: "\u202f\u00bb",
    colon: "\u202f: ",
  },

  app: {
    title: "ProPresenter Garage",
    schema: "Schéma {version}",
    offline: "Fonctionne hors ligne",
    offlineHelp: "Les fichiers sont lus dans votre navigateur. Rien n'est envoyé.",
    schemaHelp: "{files} fichiers proto du schéma {commit}, générés le {date}",
    languageLabel: "Langue",
    toolLabel: "Outil",
    themeLabel: "Apparence",
    copyright: "\u00a9 {years} Eusebius Ngemera",
    footnoteBefore: "Schéma issu de",
    footnoteLink: "greyshirtguy/ProPresenter7-Proto",
    footnoteAfter: "(non officiel). Sans lien avec Renewed Vision.",
  },


  fidelity: {
    identical: "sans perte",
    equivalent: "sans perte*",
    lossy: "avec perte — ne pas exporter",
    identicalHelp:
      "Le réencodage de ce fichier le reproduit octet pour octet : l'export est donc sûr.",
    equivalentHelp:
      "Le réencodage modifie la disposition des octets mais pas le contenu : rien ne serait perdu à l'export.",
    lossyHelp:
      "Le réencodage de ce fichier perd du contenu — il contient un élément que le schéma ne couvre pas. Un export risquerait de corrompre votre bibliothèque.",
  },

  errors: {
    empty: "Ce fichier est vide.",
    notProtobuf:
      "Ce n'est pas un fichier de liste ProPresenter (échec du décodage protobuf : {reason})",
    wrongPlaylistType: "Il s'agit d'une liste {actual}, pas d'une liste {expected}.",
    playlistType: {
      unknown: "inconnue",
      presentation: "de présentations",
      media: "de médias",
      audio: "audio",
    },
    pickFileHint:
      "Choisissez le fichier nommé « {filename} » dans votre dossier ProPresenter.",
  },



  diff: {
    summary: "Résumé",
    identical: "Les deux fichiers décrivent une bibliothèque de médias identique.",
    changeCount: [
      "{n} changement sur {from} → {to} éléments.",
      "{n} changements sur {from} → {to} éléments.",
    ],
    playlistStructure: "Structure des listes",
    changes: "Changements",
    method:
      "Appariement d'abord par UUID d'élément, puis par chemin du média. La comparaison ignore les chemins absolus enregistrés : déplacer une bibliothèque d'une machine ou d'un dossier à l'autre n'est donc pas signalé comme un changement.",
    pathMatch: "par chemin",
    pathMatchHelp: "apparié par chemin de fichier, pas par UUID",
    inPlaylist: "dans {playlist}",
    root: "(racine)",
    unmodified: "sans retouche",
    wasIn: "était dans {playlist}",
    nowIn: "désormais dans {playlist}",
    types: {
      added: "Ajouté",
      removed: "Supprimé",
      moved: "Déplacé",
      renamed: "Renommé",
      relinked: "Relié",
      restyled: "Retouché",
      retimed: "Minutage",
    },
    explain: {
      added: "média présent uniquement dans le fichier le plus récent",
      removed: "média présent uniquement dans le fichier le plus ancien",
      moved: "même média, liste différente",
      renamed: "même média, libellé différent dans ProPresenter",
      relinked: "même élément, pointant désormais vers un autre fichier",
      restyled: "même média, miroir, recadrage ou effets modifiés",
      retimed: "même média, réglages de lecture ou de transition modifiés",
    },
    playlistTypes: {
      added: "nouvelle liste",
      removed: "liste absente désormais",
      renamed: "renommée",
      recreated: "supprimée puis recréée — {before} éléments avant, {after} après",
    },
    recreated: "Recréée",
  },

  playback: {
    transitionDuration: "durée de transition",
    playbackBehavior: "lecture",
    endBehavior: "comportement en fin",
    timesToLoop: "nombre de boucles",
    loopTime: "durée de boucle",
    softLoop: "boucle douce",
    markerCount: "marqueurs",
    effectCount: "effets",
    seconds: "{n} s",
    none: "—",
    yes: "oui",
    no: "non",
  },

  mods: {
    mirroredHorizontally: "miroir horizontal",
    mirroredVertically: "miroir vertical",
    rotated: "pivoté de {degrees}°",
    blurred: "flou",
    alphaInverted: "alpha inversé",
    cropped: "recadré",
    effect: "effet : {name}",
    effectOff: "effet : {name} (désactivé)",
    scale: "échelle {value}",
    align: "alignement {value}",
  },

  library: {
    heading: "Bibliothèque",
    appOn: "ProPresenter {version} sur {platform}",
    items: "Éléments",
    playlists: "Listes",
    video: "Vidéo",
    image: "Image",
    audio: "Audio",
    other: "Autre",
    modified: "Retouchés",
  },

  audit: {
    heading: "Constats",
    method:
      "Deux entrées ne comptent comme doublons que si elles partagent un fichier et un jeu de retouches identique. Un même fichier avec un miroir, un recadrage ou des effets différents est une variante voulue, listée séparément.",
    nothing: "Rien à signaler.",
    more: ["{n} de plus", "{n} de plus"],

    withinPlaylist: "Répété dans une même liste",
    withinPlaylistWhy:
      "Le même fichier avec les mêmes retouches apparaît plusieurs fois dans une seule liste. Rarement voulu.",
    labelled: "libellé {labels}",
    allWith: "tous avec : {mods}",

    crossPlaylist: "Entrées identiques dans plusieurs listes",
    crossPlaylistWhy:
      "Un fichier, un jeu de retouches, accessible depuis plusieurs listes. En général un classement voulu — mais lorsque les libellés diffèrent, il vaut la peine de vérifier lequel est le bon.",

    variants: "Variantes d'un même fichier",
    variantsWhy:
      "Ces entrées partagent un fichier source mais chacune applique ses propres retouches : ce sont donc bien des contenus différents. Ce n'est pas un problème — c'est affiché parce que ProPresenter ne permet pas de voir quelles variantes existent.",
    unnamed: "(sans nom)",

    locations: "Emplacements enregistrés incohérents",
    locationsWhy:
      "Les éléments enregistrent des racines absolues différentes, signe que la bibliothèque a changé de dossier, de compte utilisateur ou de machine. Sans conséquence en soi — ProPresenter résout les médias par le chemin relatif — et c'est précisément pourquoi cet outil compare sur le chemin relatif.",
    locationCount: ["{n} élément", "{n} éléments"],

    external: "Médias sur volumes externes",
    externalWhy:
      "Ceux-ci sont résolus par rapport à un disque nommé et non au dossier ProPresenter. Ils disparaissent dès que ce disque n'est pas monté.",

    empty: "Listes vides",
    emptyWhy: "Listes ne contenant aucun média ni sous-liste.",

    hidden: "Éléments masqués",
    hiddenWhy: "Marqués masqués dans ProPresenter : ils n'apparaîtront pas dans le chutier.",

    nameMismatch: "Le libellé diffère du nom de fichier",
    nameMismatchWhy:
      "Entrées sans retouche dont le libellé ne ressemble pas au fichier visé. Renommer est courant, la plupart sont donc normales — occasionnellement c'est la trace d'un élément mal relié.",
  },

  browse: {
    heading: "Parcourir",
    subtitle: "{items} dans {playlists}.",
    items: ["{n} élément", "{n} éléments"],
    playlists: ["{n} liste", "{n} listes"],
    search: "Rechercher un élément, un nom de fichier ou une liste…",
    matches: ["{n} résultat", "{n} résultats"],
    itemCount: ["{n} élément", "{n} éléments"],
    subCount: "{n} sous-liste(s)",
    empty: "vide",
    unnamed: "(sans nom)",
  },

  themes: {
    system: "Système",
    light: "Clair",
    dark: "Sombre",
  },

  tools: {
    presentations: {
      name: "Présentations",
      tagline: "Vérifier le texte de toutes les présentations d'une bibliothèque",

      pickFolder: "Choisir un dossier…",
      pickFiles: "Choisir des fichiers .pro…",
      scanning: "Lecture de {n}…",
      chooseHint:
        "Choisissez votre espace de travail ProPresenter, ou son dossier Libraries. Tout est lu dans votre navigateur ; rien n'est envoyé.",
      readwriteNote:
        "Ce navigateur peut lire le dossier et, plus tard, y enregistrer les corrections.",
      readonlyNote:
        "Ce navigateur peut lire un dossier mais pas y écrire. Safari et Firefox n'offrent aucun retour vers les fichiers d'origine — utilisez Chrome ou Edge pour enregistrer les corrections sur place.",
      unavailableNote:
        "Ce navigateur ne peut pas lire de dossier. Choisissez les fichiers .pro un à un.",
      installNote:
        "Installer l'application rend l'autorisation permanente : dans un onglet, elle expire à la fermeture du dernier.",

      found: ["{n} présentation", "{n} présentations"],
      noneFound: "Aucun fichier .pro trouvé dans {folder}. Les présentations se trouvent dans le dossier Libraries d'un espace de travail ProPresenter — choisissez celui-ci, ou l'espace de travail lui-même.",
      pickerFailed:
        "Le sélecteur de dossier n'était pas disponible ; les fichiers ont été lus sous forme de copies. Les corrections ne peuvent pas être réenregistrées ainsi.",
      scanned: "Dossier {folder} lu.",
      remembered: "{folder} était ouvert la dernière fois.",
      reconnect: "Rouvrir {folder}",
      reconnectWhy:
        "L'autorisation de lire le dossier a expiré à la fermeture de l'onglet. La rouvrir demande un clic ; installer l'application la rend permanente.",
      forgetFolder: "Oublier ce dossier",
      clean: "Aucun problème de texte trouvé.",
      issuesFound: ["{n} problème dans {files}", "{n} problèmes dans {files}"],
      inFiles: ["{n} fichier", "{n} fichiers"],
      slidesAndBoxes: "{slides} diapositives · {empty} zones de texte vides",
      unreadable: "Lecture impossible : {reason}",

      slide: "diapositive {n}",
      line: "ligne {n}",
      kinds: {
        leadingSpace: "Espace au début",
        trailingSpace: "Espace à la fin",
        blankLine: "Ligne vide",
        repeatedSpace: "Espace double",
      },
      why: {
        leadingSpace: "La ligne commence par une espace, ce qui la décale vers la droite à l'écran.",
        trailingSpace: "La ligne finit par une espace. Invisible dans l'éditeur, mais cela affecte le centrage.",
        blankLine: "Une ligne entre deux lignes de texte qui n'affiche rien — elle laisse un trou sur la diapositive.",
        repeatedSpace: "Deux espaces ou plus à la suite dans la ligne.",
      },
      emptyBoxesNote:
        "Les zones de texte sans aucun texte sont comptées, pas listées : les thèmes ProPresenter en laissent systématiquement sur les diapositives.",
      showAll: "Afficher les {n}",
    },
    mediaBin: {
      name: "Médias",
      tagline: "Comparer et analyser les listes de médias",

      baseline: "Référence",
      compare: "Comparer avec",
      baselineHint: "Déposez votre fichier Media ici, ou cliquez pour le choisir",
      compareHint:
        "Facultatif — déposez un second fichier Media pour voir les différences",
      baselineSuffix: "(référence)",
      pickFileHint:
        "Choisissez le fichier nommé « Media » dans le dossier Playlists de votre espace de travail ProPresenter.",

      startHeading: "Chargez un fichier de liste de médias pour commencer",
      whereIntro:
        "C'est le fichier nommé Media, sans extension, dans le dossier Playlists de votre espace de travail ProPresenter.",
      whereWindows: "Windows",
      whereMac: "macOS",
      whereLegacy: "ProPresenter 19 et antérieur, sur les deux plateformes",
      whereWorkspaceNote:
        "ProPresenter 20 a déplacé l'espace de travail hors de Documents. Le dossier indiqué par {placeholder} porte le nom de votre espace de travail — en général ProPresenter, sauf si vous l'avez renommé.",
      oneOrTwo:
        "Un fichier donne une analyse. Deux fichiers donnent une comparaison.",

      replace: "Remplacer",
      items: ["{n} élément", "{n} éléments"],
      playlists: ["{n} liste", "{n} listes"],
      appOn: "ProPresenter {version} · {platform}",

      diffDisabled: "Chargez un second fichier pour comparer",
      tabs: {
        diff: "Différences",
        audit: "Analyse",
        browse: "Parcourir",
        reorganise: "Réorganiser",
      },

      merge: {
        heading: "Reporter des modifications",
        intro:
          "Choisissez des modifications et appliquez-les à un côté, puis exportez-le. Le fichier chargé n'est jamais écrit : l'export produit une copie distincte.",
        direction: "Appliquer à",
        intoBaseline: "Référence ({filename})",
        intoCompare: "Comparaison ({filename})",
        selectAll: "Tout sélectionner",
        selectNone: "Tout désélectionner",
        selected: ["{n} modification sélectionnée", "{n} modifications sélectionnées"],
        applyAndExport: "Appliquer et exporter",
        blocked: [
          "{n} modification ne peut pas être appliquée",
          "{n} modifications ne peuvent pas être appliquées",
        ],
        blockedWhy: "Leur entrée est introuvable dans le fichier d'origine.",
        blockedDestructive:
          "Une liste recréée ne peut pas être reportée : cela supprimerait la liste de ce côté et tout son contenu.",
        willCreate: ["Crée {n} liste : {names}", "Crée {n} listes : {names}"],
        exportBlocked:
          "Ce côté ne peut pas être exporté : le réencodage perd du contenu que le schéma ne couvre pas.",
        exportedAs:
          "Exporté sous {filename}. Vérifiez-le dans ProPresenter avant de remplacer quoi que ce soit.",
        failed: "Ces modifications n'ont pas pu être appliquées ensemble : {reason}",
        nothingSelected: "Aucune sélection.",
      },

      reorganise: {
        heading: "Réorganiser",
        intro:
          "Les modifications sont rassemblées ici et appliquées seulement à l'export. Votre fichier d'origine n'est jamais écrit : l'export produit une copie distincte que vous mettez en place vous-même.",
        pending: ["{n} modification en attente", "{n} modifications en attente"],
        none: "Aucune modification pour l'instant.",
        undo: "Annuler la dernière",
        discard: "Tout abandonner",
        exportFile: "Exporter le fichier",
        exportBlocked:
          "Ce fichier ne peut pas être exporté : le réencodage perd du contenu que le schéma ne couvre pas.",
        exportedAs:
          "Exporté sous {filename}. Vérifiez-le dans ProPresenter avant de remplacer quoi que ce soit.",
        broken:
          "Ces modifications ne s'appliquent plus à ce fichier. Annulez la dernière ou abandonnez tout.",

        quickFixes: "Corrections rapides",
        quickFixesWhy:
          "Issues de l'analyse. Chacune met en file des modifications ordinaires, que vous pouvez relire et annuler ci-dessous.",
        removeDuplicates: ["Supprimer {n} doublon", "Supprimer {n} doublons"],
        removeDuplicatesWhy:
          "Conserve la première de chaque entrée répétée dans une même liste, avec des retouches identiques.",
        removeEmpty: ["Supprimer {n} liste vide", "Supprimer {n} listes vides"],
        removeEmptyWhy: "Listes ne contenant aucun média ni sous-liste.",
        showAffected: "Voir ce que cela change",
        affectedItem: "{name} — dans {playlist}",
        viewInAudit: "Voir dans l'analyse",
        keeping: "conserve {name}",
        differentName: "nom différent — vérifiez lequel garder",
        nothingToFix: "L'analyse n'a rien trouvé à corriger automatiquement.",

        rename: "Renommer",
        remove: "Supprimer",
        moveUp: "Monter",
        moveDown: "Descendre",
        moveTo: "Déplacer vers…",
        renameItemPrompt: "Nouveau nom pour cet élément",
        renamePlaylistPrompt: "Nouveau nom pour cette liste",
        removePlaylistConfirm:
          "Supprimer {name} et ses {n} éléments ? Vous pouvez encore annuler avant l'export.",
        emptyPlaylist: "vide",
      },
    },
  },

  units: {
    bytes: "{n} o",
    kilobytes: "{n} ko",
    megabytes: "{n} Mo",
  },

  kinds: {
    video: "vidéo",
    image: "image",
    audio: "audio",
    live_video: "vidéo live",
    other: "autre",
  },
};
