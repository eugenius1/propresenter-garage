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
    schema: "schéma {version}",
    offline: "fonctionne hors ligne",
    offlineHelp: "Les fichiers sont lus dans votre navigateur. Rien n'est envoyé.",
    schemaHelp: "{files} fichiers proto du schéma {commit}, générés le {date}",
    languageLabel: "Langue",
    themeLabel: "Apparence",
    footnoteBefore: "Schéma issu de",
    footnoteLink: "ProPresenter7-Proto",
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
    },
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
        "Choisissez le fichier nommé « Media » dans votre dossier ProPresenter.",

      startHeading: "Chargez un fichier de liste de médias pour commencer",
      whereWindows: "Sous Windows il se trouve dans",
      whereMac: "sous macOS dans",
      noExtension: "Il n'a pas d'extension.",
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
