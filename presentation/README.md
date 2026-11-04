# Presentation assets

Companion decks for OpenShift Local (CRC) on Fedora. All three share one Red Hat
visual language so they read as a family, and each is built programmatically with
`pptxgenjs` from a `deck.js` builder, with speaker notes on every slide.

```
presentation/
├── deck-helpers.js         ← shared house helpers (COLOR/FONT + slide helpers)
├── assets/                 ← shared cover/divider panels and logos
├── openshift-101/          ← orientation deck: what CRC is and the OpenShift model
│   ├── deck.js             ← 20 slides; the mental model (oc, Projects, SCC, Routes, Operators, registry)
│   └── openshift-101-r01.0.pptx
├── openshift-201/          ← implementation deck: build the data mesh on CRC
│   ├── deck.js             ← 23 slides; images, Helm, storage, scaling, mesh, operators
│   └── openshift-201-r01.0.pptx
├── k8s-patterns-appendix/  ← the §18 appendix as a deck, mapped to DO280/EX280
│   ├── deck.js             ← 44 slides; 33 patterns, data-driven, with embedded diagrams
│   └── kubernetes-patterns-on-openshift-r01.0.pptx
└── README.md               ← this file
```

- **openshift-101** is the concept and orientation deck: a real single-node
  OpenShift cluster in one VM, `oc` as a `kubectl` superset, Projects,
  restricted-v2, Routes with edge TLS, Operators, and the integrated registry.
- **openshift-201** is the implementation companion: it builds the seven-service
  data-mesh reference application on CRC, walking images, Helm, persistent
  storage, autoscaling, the service mesh, and the platform operators.
- **k8s-patterns-appendix** works the 33 Kubernetes design patterns from the
  §18 appendix, each verified live under restricted-v2 and mapped to its
  DO280/EX280 objective, closing with the exam crosswalk.

## Building the decks

`pptxgenjs` is installed locally in `presentation/node_modules`. Each deck reads
the shared helpers and its own `png/` directory of rasterized diagrams.

```bash
cd presentation
npm install                       # once, installs pptxgenjs

cd openshift-101                  # (or openshift-201, k8s-patterns-appendix)
export NODE_PATH=$PWD/../node_modules DECK_ASSETS=../assets DECK_PNG=./png
node deck.js                      # writes the .pptx
```

The diagram PNGs under each deck's `png/` are rasterized from the site's
`assets/diagrams/*.svg` with `cairosvg`; the editable `.excalidraw` sources live
alongside the SVGs in the repo.

## QA

```bash
soffice --headless --convert-to pdf --outdir qa <deck>.pptx
pdftoppm -jpeg -r 110 -f N -l N qa/<deck>.pdf qa/pg
```
