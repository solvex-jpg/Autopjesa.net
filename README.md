# AUTOPJESA.NET

Marketplace për pjesë veturash dhe pajisje servisi. Faqja është ndërtuar me HTML, CSS dhe JavaScript pa framework, me një server Node.js për llogaritë, njoftimet, porositë dhe integrimin opsional të Paysera.

## Kërkesat

- Node.js 18 ose më i ri
- npm (vjen bashkë me Node.js)

## Nisja lokalisht

```sh
npm start
```

Hap `http://127.0.0.1:8787` në shfletues. Për port ose host tjetër vendos `PORT` dhe `HOST` si variabla mjedisi.

Për konfigurim lokal, kopjo shembullin dhe plotëso vlerat vetëm në `.env`:

```sh
cp .env.example .env
```

Mos e dërgo `.env` në GitHub. `.env.example` përmban vetëm vlera shembull.

## Të dhënat dhe llogaritë

Backend-i lokal ruan llogaritë, sesionet, porositë dhe njoftimet te `data/`. Kjo dosje përjashtohet nga Git. Të dhënat ruhen lokalisht në server dhe nuk sinkronizohen mes serverëve. Para përdorimit publik, zëvendëso ruajtjen me skedarë me databazë të qëndrueshme dhe vendose serverin pas HTTPS.

## Paysera

Pagesat e promovimeve kërkojnë këto variabla private:

- `PAYSERA_PROJECT_ID`
- `PAYSERA_PROJECT_PASSWORD`
- `PAYMENT_PUBLIC_URL`
- `PAYMENT_TEST=1` për ambientin testues

Konfiguroji në `.env` lokalisht ose në panelin e hosting-ut. Mos i vendos në JavaScript, HTML, `netlify.toml`, apo në GitHub.

## GitHub dhe hosting

Projekti mund të ngarkohet në GitHub si repo private ose publike. Mos përfshi `.env`, `data/`, apo të dhëna reale të përdoruesve.

Faqja statike mund të publikohet veçmas, por `server.js` është server Node.js i vazhdueshëm. Netlify nuk e nis këtë server si proces të zakonshëm: API-ja duhet përshtatur në Netlify Functions dhe ruajtja në skedarë duhet kaluar në databazë para se llogaritë dhe porositë të punojnë në hosting.

## Gjendja e verifikimit

- Regjistrimi me email aktualisht përdor kod demonstrues; nuk dërgohet email verifikimi.
- Pagesat Paysera nuk punojnë derisa të vendosen kredencialet e projektit dhe URL-ja publike HTTPS.
