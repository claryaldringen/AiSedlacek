# Caddy – bezpečné servírování `/uploads/*`

Doplněk k opravám SEC-1 a SEC-13 z code review 2026-10-14
(`CODE-REVIEW-2026-10-14.md`, sekce 4 a 14). **Aplikuje se ručně na serveru** –
Caddyfile není v repu.

## Proč

Caddy pro `aisedlacek.com` servíruje `/uploads/*` přímo `file_server` z
`/opt/AiSedlacek/uploads`. `Content-Type` určuje podle přípony souboru a
bezpečnostní hlavičky z `apps/web/next.config.ts` (nosniff, CSP,
X-Frame-Options) se na tyto odpovědi **nevztahují** – platí jen pro odpovědi
Next.js.

Aplikace od opravy SEC-1 ukládá jen ověřené obrázky pod jménem
`<uuid>.<jpg|png|webp|tif|gif>`. Na disku ale zůstávají soubory nahrané dřív
pod původním jménem klienta (`<uuid>-<jméno>.<přípona>`), mezi nimiž může být
HTML nebo SVG se skriptem. Konfigurace níže je druhá vrstva obrany: i kdyby se
na disk dostal neobrázkový soubor, prohlížeč ho nespustí jako aktivní obsah
v originu aplikace.

## Doporučená konfigurace

V bloku `aisedlacek.com` (typicky `/etc/caddy/Caddyfile`) nahradit stávající
obsluhu `/uploads/*` tímto blokem:

```caddyfile
aisedlacek.com {
	# … stávající konfigurace (reverse_proxy na 127.0.0.1:3003 atd.) …

	handle /uploads/* {
		# Servírovat jen obrázkové přípony, všechno ostatní 404.
		@notImage not path *.jpg *.jpeg *.png *.webp *.tif *.tiff *.gif
		respond @notImage 404

		header {
			# Prohlížeč nesmí hádat typ obsahu z dat.
			X-Content-Type-Options nosniff
			# Otevřený soubor nesmí spouštět skripty, načítat cizí zdroje ani
			# přistupovat k cookies originu (sandbox = unikátní origin).
			Content-Security-Policy "default-src 'none'; img-src 'self'; sandbox"
			# ZACHOVAT stávající cache hlavičku – sem zkopírovat aktuální hodnotu,
			# např.:
			# Cache-Control "public, max-age=31536000, immutable"
		}

		root * /opt/AiSedlacek
		file_server
	}
}
```

Poznámky:

- `handle /uploads/*` používá inline cestu, aby ho Caddy seřadil před obecný
  `handle` / `reverse_proxy` bez matcheru. Pokud už v konfiguraci existuje jiný
  blok pro `/uploads/*` (`handle`, `route`, `file_server` s matcherem), je
  potřeba ho tímto blokem **nahradit**, ne přidat druhý.
- `root * /opt/AiSedlacek` + cesta `/uploads/<soubor>` → soubor
  `/opt/AiSedlacek/uploads/<soubor>` (odpovídá `UPLOAD_DIR` v `.env`).
- Matcher `path` v Caddy porovnává bez ohledu na velikost písmen, takže projdou
  i starší soubory s příponou `.JPG` / `.PNG`.
- `img-src 'self'` umožní zobrazit obrázek otevřený přímo v prohlížeči; vložení
  přes `<img>` na stránkách aplikace CSP obrázkové odpovědi neovlivňuje.
- `respond … 404` dostane také hlavičky z `header` – to nevadí.

## Před nasazením – kontrola stávajících souborů

Matcher začne vracet 404 pro všechny soubory s jinou než obrázkovou příponou.
Nejdřív zjistit, co na disku je:

```bash
# Přehled přípon (case-insensitive)
find /opt/AiSedlacek/uploads -type f | sed 's/.*\.//' | tr 'A-Z' 'a-z' | sort | uniq -c | sort -rn

# Soubory, jejichž obsah není obrázek (bez ohledu na příponu)
find /opt/AiSedlacek/uploads -type f -exec file --mime-type {} + | grep -v ': image/'
```

- Neobrázkové přípony nebo obsah (HTML, SVG, XML, PDF, skripty) prověřit –
  mohou to být pokusy o zneužití SEC-1. Než je smažete, dohledejte v DB
  `Page.imageUrl` a vlastníka (`Page.userId`).
- Legitimní obrázky s neobvyklou příponou (např. `.jpe`, `.jfif`) by po
  nasazení vracely 404; buď je přidat do matcheru, nebo soubory přejmenovat
  a opravit `Page.imageUrl`.

## Nasazení a ověření

```bash
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

# Existující obrázek → 200 + hlavičky nosniff a CSP, Cache-Control beze změny
curl -sI https://aisedlacek.com/uploads/<existující-soubor>.jpg

# Neobrázková přípona → 404
curl -sI https://aisedlacek.com/uploads/test.html
curl -sI https://aisedlacek.com/uploads/test.svg
```

## Co tím vyřešené není

- **SEC-7 – autorizace:** soubory jsou dál veřejné pro každého, kdo zná URL
  (UUID v názvu je neuhodnutelné, ale nejde odvolat). Řešením je servírovat
  přes route s kontrolou vlastnictví / `isPublic` (např. `forward_auth`) nebo
  podepsané URL – samostatný úkol.
- **Oddělená doména:** dlouhodobě je nejbezpečnější servírovat uživatelský
  obsah z jiné domény bez cookies aplikace (např. `files.aisedlacek.com`).
- `/api/images/*` (starší URL obrázků) obsluhuje Next.js – tam hlavičky
  z `next.config.ts` platí a změna v Caddy není potřeba.
