# Cinefield — Faz 6 Proje Tanımı ve Hatırlatma Metni

> **Bu dosya bir prompt'tur.** Yeni bir Claude oturumu açtığınızda bu dosyayı
> göstermeniz (veya "docs/FAZ-6-PROJE-TANIMI.md dosyasını oku ve devam et"
> demeniz) yeterlidir. İçinde neyin çalıştığı, neyin çalışmadığı, hangi
> kuralların kalıcı olduğu ve sıradaki işin ne olduğu yazılıdır.
>
> Son güncelleme: 2026-08-08

---

## 1. Proje nedir?

**Cinefield** — Next.js 16.2.9 üzerine kurulu, çok sağlayıcılı bir yapay zekâ
üretim platformu. Görsel, video ve ses üretimini tek bir orkestrasyon
katmanı üzerinden yönetir.

**Mimarinin değişmez kuralı:** Sağlayıcıdan bağımsızlık.

```
Kullanıcı arayüzü
      ↓
model-registry.ts          ← TEK doğruluk kaynağı, çalıştırma kapısı
      ↓
orchestrator.ts            ← sağlayıcıya özel HİÇBİR if yok
      ↓
ProviderAdapter            ← sağlayıcı başına BİR adaptör (model başına değil)
      ↓
fal / cloudflare / ...
```

- Şema farklılıkları model-ID'ye göre `if` ile değil, registry'deki bildirimsel
  alanlarla çözülür: `falSizeParam`, `falSupportsResolution`, `cloudflareTextField`
- **Cloudflare AI Gateway bir taşıyıcıdır, sağlayıcı değildir.** Tek sağlayıcı
  kimliği `cloudflare-workers-ai`'dir; gateway bilgisi yalnızca çıktı
  metadata'sında yaşar

---

## 2. KALICI KURALLAR — asla ihlal edilmez

### 2.1 Generate butonu

**Model entegrasyonları sırasında Generate butonuna ASLA basma.** Gerçek,
ücretli bir üretimi kendi başına tetikleme.

Ücretsiz doğrulama yolları: `npx tsc --noEmit`, `npm run build`, kontrol
render'ları, gönderilecek payload'ın incelenmesi, `mock-*` modelleri, DB satır
kontrolü.

Entegrasyon bitince kullanıcıya teslim et: *"hazır — Generate'e basıp test
edebilirsiniz."* Gerçekten gerekliyse **önce sor ve tahmini maliyeti söyle**.

### 2.2 Sözleşme / lisans / ödeme

Kullanıcının hesabı adına lisans, AUP, hizmet şartı, abonelik, faturalama,
ödeme, plan, pazaryeri veya hesap düzeyinde hiçbir anlaşmayı **o eylem için
açık onay olmadan** kabul etme.

**Bir menüden seçenek seçilmesi yeterli onay DEĞİLDİR.** Böyle bir kapıya
gelirsen dur ve bildir.

### 2.3 Güvenlik (kelimesi kelimesine korunacak)

- `.env.local` asla gösterilmez
- Hiçbir sır yazdırılmaz, maskelenmez, hash'lenmez, kısmen açığa çıkarılmaz
- Ortam kontrolleri yalnızca boolean olur
- `NEXT_PUBLIC_` ile sağlayıcı sırrı taşınmaz
- Sır; veritabanına, metadata'ya, log'a veya istemci paketine girmez
- İmzalı URL'ler kalıcı olarak saklanmaz
- `output_url` yalnızca özel Storage yolunu içerir
- Ham sağlayıcı yanıtları kalıcı olarak saklanmaz
- Her kontrollü testten sonra Cloudflare tekrar kapatılır
- Başarısız olan bir dış sağlayıcı testi elle tekrarlanmaz

### 2.4 Kilitli sayfalar — dokunma

| Sayfa / dizin | Durum |
|---|---|
| `/generate` + `src/components/cinema-studio/**` | 🔒 TAM KİLİTLİ |
| `/audio/create` | 🔒 TAM KİLİTLİ |
| `/marketing-studio/product` | 🔒 KİLİTLİ |
| `/supercomputer` | 🔒 KİLİTLİ |
| `/` (ana sayfa + navbar) | 🔒 KİLİTLİ |
| Auth modal | 🔒 KİLİTLİ |

**Paylaşımlı dosya tuzağı:** `ModelCapabilityControls.tsx` ve
`imageModelCapabilities.ts` hem `/image` hem `/generate` tarafından okunur.
Buradaki bir değişiklik kilitli sayfaya sızar. `/image`'e özel davranış
gerekiyorsa `/image`-özel bir haritaya koy (`GPT_IMAGE_PAGE_CONTROLS` deseni).

### 2.5 Doğruluk

Dosya yolu, model ID'si, endpoint, dil, süre, çözünürlük, çıktı sayısı, prompt
limiti, fiyat veya yetenek **uydurma**. Yetkili bir kaynak yoksa **o alanı
tamamen atla**.

### 2.6 Commit / push

Build geçtikten sonra otomatik commit + push. Fazla çıktı ve özet üretme.
Kural 2.1'deki Generate yasağıyla karıştırma — push serbest, Generate yasak.

---

## 3. Şu anki gerçek durum

### 3.1 Çalışan

| Özellik | Durum |
|---|---|
| Orkestrasyon hattı (registry → orchestrator → adapter) | ✅ Çalışıyor |
| fal.ai görsel üretimi | ✅ Doğrulandı (Nano Banana 2, 1792×2400 @ 3:4/2K) |
| `useGeneration` paylaşımlı hook (5 sayfa) | ✅ Çalışıyor |
| Supabase satır + imzalı URL teslimi | ✅ Çalışıyor |
| Yeniden deneme / idempotency (`claimGeneration`) | ✅ Düzeltildi ve test edildi |
| Prompt sınıflandırma (Cloudflare Llama 3.1 fast) | ✅ Çalışıyor |
| Görüntü analizi / moderasyon / embedding / rerank | ✅ Route'lar mevcut |

### 3.2 ÇALIŞMAYAN — abartma, olduğu gibi bildir

| Konu | Gerçek |
|---|---|
| **Cloudflare TTS** | ❌ **DOĞRULANMADI.** MeloTTS ve Aura-2 gerçek üretimde başarısız oldu. Doğru sınıflandırma: *"TTS entegrasyon yolu hazır ✅ / Cloudflare TTS modelleri başarılı çıktı üretmedi ❌"*. Çalışan özellik olarak kullanma. |
| **Video üretimi** | ❌ Çalışan model yok. `executionMode: "async"` tanımlı ama `orchestrator.ts` hiç `getStatus` çağırmıyor — async yol yok. |
| **`mock-video`** | ❌ Hiç uygulanmadı (`MOCK_VIDEO_NOT_IMPLEMENTED`) |
| **`/image` modellerinin 25'i** | ❌ Registry kaydı yok. `setTimeout(1600)` sahte gecikmesine düşüyor. |
| **~90 kozmetik model** | ❌ Seçilirse sonsuza kadar `queued` kalıyor, hata vermiyor |
| **Gerçek iptal (Cancel)** | ❌ Hiçbir katmanda yok. DB'de `"cancelled"` enum değeri var ama **hiçbir kod yazmıyor**. Cancel API yok, istemcide `AbortController` yok. |
| **Gerçek ilerleme yüzdesi** | ❌ Yok. Route tek JSON döner, streaming/SSE yok. Sadece belirsiz spinner dürüst. |

### 3.3 Bilinen teknik borç

- **`mock-output` dosya adı hatası** (commit `2a685b6`, Faz 5 öncesi): gerçek
  ücretli üretimler `mock-output-…` adıyla saklanıyor. Biri temizlik script'i
  yazarsa sessiz veri kaybı olur. **Bildirildi, düzeltilmedi.**
- Durum bloğu 3 sayfada kopyalanmış: `CreateImageWorkspace.tsx:136`,
  `CreateAudioWorkspace.tsx:209`, `MarketingStudioProductWorkspace.tsx:474`

---

## 4. SIRADAKİ İŞ — sırayla

### Adım 1 · Üretim kartı (ÖNCE bu yapılır)

**Neden önce:** Kart, 25 model entegrasyonunun test aletidir. Sona bırakmak
25 entegrasyonu kör test etmek demektir.

**Referans davranış** (higgsfield.ai/ai/image ekran kayıtlarından doğrulandı):

1. Generate'e basılır
2. Hero kolajı kaybolur
3. İçerik alanının **sol üstünde** bir kart belirir:
   `◜ Generating` (lime yazı + dönen spinner) + altında gövde kartı
4. Üretim bitince görsel **tam aynı hücrede** kartın yerini alır
5. Prompt bar hiç kıpırdamaz

**Referansta OLMAYAN:** Cancel butonu yok, yüzde/ilerleme çubuğu yok.

**Kararlar:**

| Konu | Karar |
|---|---|
| Kapsam | Kademe 1 — sadece üretim kartı, ızgara yok |
| Ekleme noktası | `CreateImageWorkspace.tsx:132–134` (`<HeroSection>` alanı) + 136–173 bloğunun kaldırılması |
| Yeni dosya | `createImage/GenerationProgressPanel.tsx` — saf görsel, prop alır, state tutmaz |
| Gövde içeriği | Prompt metni + model / oran / kalite (bize ait gerçek veri) |
| Kart oranı | Seçilen aspect ratio'ya göre |
| Bağlı olmayan model | Açık "bu model henüz bağlı değil" durumu — sahte "Generating" gösterme |
| Cancel | **Yok.** Referansta da yok. Sahte iptal yazmak kullanıcıya para kaybettirir. |
| Spinner | `Loader2` + `animate-spin` (zaten import edilmiş) |
| Z-index | `z-[100]` — daha yükseği popover'ları kapatır (portal `z-[100000]`) |

**Dokunulmayacak:** `PromptComposer.tsx`, `useGeneration.ts`,
`ModelCapabilityControls.tsx`, `imageModelCapabilities.ts`, cinema-studio/**,
diğer 4 sayfa.

### Adım 2 · Modelleri tek tek fal.ai'ye bağla

**Desen** (Nano Banana 2'de kanıtlandı, her model için aynı):

1. fal.ai endpoint'ini ve giriş şemasını doğrula — **uydurma**
2. `model-registry.ts`'e kayıt ekle (yetenekler gerçek belgelenmiş değerlerden)
3. `CreateImageWorkspace.tsx` → `CATALOG_TO_REGISTRY_MODEL`'e 1 satır
4. Gerekiyorsa `falSizeParam` / `falSupportsResolution` ayarla —
   **model-ID'ye göre `if` yazma**
5. `npx tsc --noEmit` + `npm run build`
6. Kontrol satırının doğru render olduğunu, payload'ın doğru çıktığını doğrula
7. **Kullanıcıya teslim et** — Generate'e o basar
8. Onaylanınca commit + push

**Her seferde bir model. Toplu entegrasyon yok.**

| # | Model | Durum |
|---|---|---|
| 1 | Nano Banana 2 | ✅ Bağlı ve doğrulandı |
| 2 | Nano Banana Pro | ⬜ fal endpoint doğrulandı |
| 3 | Seedream 5.0 Lite | ⬜ fal endpoint doğrulandı |
| 4 | Seedream 5.0 Pro | ⬜ fal endpoint doğrulandı |
| 5 | Seedream 4.5 | ⬜ fal endpoint doğrulandı |
| 6 | Seedream 4.0 | ⬜ fal endpoint doğrulandı |
| 7 | FLUX.2 Pro | ⬜ fal endpoint doğrulandı |
| 8 | Z-Image | ⬜ fal endpoint doğrulandı |
| 9 | Recraft V4.1 | ⬜ fal endpoint doğrulandı |
| — | Diğer ~17 katalog modeli | ⬜ fal'da karşılığı **doğrulanmadı** — bulunmazsa bağlanmaz |

> Karşılığı olmayan modeli zorlama. Bağlanamayan model, açık "bağlı değil"
> durumunda kalır — sessiz `queued` bırakma.

### Adım 3 · TAM KAPSAMLI TEST (tüm entegrasyonlar bitince)

**Bu aşama kullanıcının açık onayıyla başlar ve ücretli üretim içerir.**
Başlamadan önce toplam tahmini maliyeti bildir.

**A · Ücretsiz kontroller (önce bunlar)**

- [ ] `npx tsc --noEmit` — sıfır hata
- [ ] `npm run build` — sıfır hata, sıfır yeni uyarı
- [ ] `git diff --check` — temiz
- [ ] `.env.local` git'te izlenmiyor
- [ ] Sır taraması: bundle'da ve DB'de sağlayıcı anahtarı yok
- [ ] Her modelin kontrol satırı doğru render oluyor (26 model tek tek)
- [ ] Her modelin oran listesi kendi listesi — evrenselleştirilmemiş
- [ ] Klavye navigasyonu her modelde çalışıyor (←/→/Home/End/↓)
- [ ] `mock-*` modelleriyle uçtan uca akış
- [ ] Kilitli sayfalar görsel olarak değişmemiş (`/generate`, `/audio/create`,
      `/marketing-studio/product`, `/supercomputer`, `/`)

**B · Ücretli üretim testleri (kullanıcı onayı + kullanıcı basar)**

Her bağlı model için bir üretim:

- [ ] Doğru boyut geldi mi? (oran × çözünürlük eşleşiyor mu)
- [ ] Çıktı sayısı doğru mu?
- [ ] Üretim kartı: Generating → sonuç geçişi düzgün mü?
- [ ] Supabase satırı `completed`, `output_url` özel yol, imzalı URL çalışıyor
- [ ] Ham sağlayıcı yanıtı saklanmamış
- [ ] Hata durumu: geçersiz prompt ile anlamlı hata mesajı

**C · Regresyon**

- [ ] Navbar'dan model seçimi her sayfadan `/image`'e doğru modelle gidiyor
- [ ] `?model=` dev override hâlâ çalışıyor
- [ ] Yeniden deneme (`resetForRetry`) çalışıyor
- [ ] 🚫 işaretli modeller hâlâ çalıştırılamıyor (`findModel` → `undefined`)

**Test raporunda:** Geçen/kalan sayısı, başarısız olanların çıktısı,
atlananlar ve nedeni. Başarısızlığı gizleme, "çalışıyor" deme.

### Adım 4 · Sonraki (henüz başlanmadı)

- `mock-output` dosya adı hatasının düzeltilmesi
- Kayıtsız modeller için sessiz `queued` yerine dürüst hata
- Video / async yürütme yolu (`getStatus` çağrısı)
- Yeni sağlayıcılar: Replicate, Runway, Runware, Google Veo, ElevenLabs
  — her biri **bir adaptör**, orkestratöre `if` eklemeden

---

## 5. Kilit dosya haritası

| Dosya | Rolü |
|---|---|
| `src/lib/orchestration/model-registry.ts` | Tek doğruluk kaynağı + çalıştırma kapısı |
| `src/lib/orchestration/orchestrator.ts` | Sağlayıcıdan bağımsız yürütme |
| `src/lib/orchestration/providers/fal-provider.ts` | fal adaptörü (tüm fal modelleri) |
| `src/lib/orchestration/status-manager.ts` | `claimGeneration` / `markCompleted` / `markFailed` / `resetForRetry` |
| `src/lib/blockedModels.ts` | 🚫 rakip marka kilidi |
| `src/hooks/useGeneration.ts` | Paylaşımlı istemci akışı — **5 sayfa kullanıyor, dikkat** |
| `src/app/api/orchestration/execute/route.ts` | Tek giriş noktası (`generationId` tek gövde alanı) |
| `src/components/landing/createImage/CreateImageWorkspace.tsx` | `/image` sayfası — katalog→registry haritası burada |
| `src/components/landing/createImage/PromptComposer.tsx` | `/image` prompt bar (yeniden boyutlanabilir, 140–360px) |

---

## 6. Bu oturumda ne yapılmayacak

- Faz 6'ya kullanıcı söylemeden başlama
- Birden fazla modeli tek seferde entegre etme
- Kilitli sayfalara dokunma
- Generate'e basma
- Çalışmayan bir şeyi çalışıyor gibi raporlama
- Doğrulanmamış değer uydurma
