/**
 * PariuVerde / GreenBetTips temporary homepage enhancements.
 * Installed through Code Snippets; intentionally contains no opening PHP tag.
 */
add_action('wp_footer', function () {
    if (is_admin()) return;

    $is_en = stripos((string) home_url(), 'greenbettips') !== false;
    $config = $is_en ? [
        'brand' => 'GreenBetTips.com',
        'telegram' => 'https://t.me/greenbettips_com',
        'facebook' => 'https://www.facebook.com/greenbet.tips/',
        'instagram' => 'https://www.instagram.com/nick_verde_2025/',
        'tiktok' => 'https://www.tiktok.com/@greenbtps',
        'youtube' => 'https://www.youtube.com/@GreenBetTips',
        'title' => 'Get today’s picks instantly',
        'copy' => 'Join our Telegram channel for the daily tickets and clearly marked LIVE betting signals.',
        'join' => 'Join Telegram',
        'later' => 'Maybe later',
    ] : [
        'brand' => 'PariuVerde.ro',
        'telegram' => 'https://t.me/pariuverde',
        'facebook' => 'https://www.facebook.com/PeVerde',
        'instagram' => 'https://www.instagram.com/nick_verde_2025/',
        'tiktok' => 'https://www.tiktok.com/@nicu4578',
        'youtube' => 'https://www.youtube.com/@pontverde',
        'title' => 'Primește ponturile imediat',
        'copy' => 'Intră pe canalul nostru de Telegram pentru biletele zilei și semnalele de pariere marcate clar LIVE.',
        'join' => 'Intră pe Telegram',
        'later' => 'Poate mai târziu',
    ];

    $json = wp_json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    ?>
    <style id="pv-site-experience-css">
      body.home .elementor-element[data-id="1fe2321b"]{display:none!important}
      .pv-tg-overlay{position:fixed;inset:0;z-index:999999;background:rgba(4,15,12,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;visibility:hidden;transition:.22s ease}
      .pv-tg-overlay.is-open{opacity:1;visibility:visible}.pv-tg-card{position:relative;width:min(460px,100%);border:1px solid rgba(43,213,119,.35);border-radius:22px;padding:34px 30px 28px;background:linear-gradient(145deg,#071b15,#0b2c20);color:#fff;box-shadow:0 25px 80px rgba(0,0,0,.45);text-align:center}
      .pv-tg-icon{width:66px;height:66px;border-radius:18px;margin:0 auto 18px;display:grid;place-items:center;background:#25a7e8;box-shadow:0 10px 30px rgba(37,167,232,.3);font-size:34px}.pv-tg-card h2{color:#fff!important;font-size:27px!important;line-height:1.2!important;margin:0 0 12px!important}.pv-tg-card p{color:#d8e9e2!important;font-size:16px;line-height:1.55;margin:0 auto 23px;max-width:370px}
      .pv-tg-actions{display:flex;gap:11px;justify-content:center;flex-wrap:wrap}.pv-tg-join,.pv-tg-later{border:0;border-radius:999px;padding:13px 22px;font-weight:800;font-size:15px;cursor:pointer;text-decoration:none!important}.pv-tg-join{background:#20d276;color:#032116!important}.pv-tg-later{background:transparent;color:#d8e9e2;border:1px solid rgba(255,255,255,.25)}.pv-tg-close{position:absolute;right:14px;top:12px;border:0;background:transparent;color:#fff;font-size:27px;line-height:1;cursor:pointer;padding:5px}.pv-tg-note{display:block;margin-top:18px;font-size:11px;opacity:.62}
      @media(max-width:520px){.pv-tg-card{padding:31px 20px 24px}.pv-tg-actions{display:grid}.pv-tg-join,.pv-tg-later{width:100%}}
    </style>
    <script id="pv-site-experience-js">
    (() => {
      const c = <?php echo $json; ?>;
      const links = {facebook:c.facebook, instagram:c.instagram, youtube:c.youtube, telegram:c.telegram};
      Object.entries(links).forEach(([network,url]) => {
        document.querySelectorAll(`a.elementor-social-icon-${network}, a.ast-${network}`).forEach(a => {
          a.href=url; a.target='_blank'; a.rel='noopener noreferrer';
        });
      });
      document.querySelectorAll('a.elementor-social-icon-x-twitter:not([href]),a.elementor-social-icon-whatsapp:not([href])').forEach(a => a.closest('.elementor-grid-item')?.remove());
      const socialWrap=document.querySelector('.elementor-element[data-id="6079c56f"] .elementor-social-icons-wrapper');
      if(socialWrap && !socialWrap.querySelector('.pv-social-tiktok')){
        const item=document.createElement('span'); item.className='elementor-grid-item pv-social-tiktok'; item.setAttribute('role','listitem');
        item.innerHTML=`<a class="elementor-icon elementor-social-icon" href="${c.tiktok}" target="_blank" rel="noopener noreferrer" aria-label="TikTok" style="background:#111;color:#fff;font-weight:900;font-size:17px">♪</a>`;
        socialWrap.appendChild(item);
      }
      if(!document.body.classList.contains('home')) return;
      const key=`pvTelegramInvite:${location.hostname}`;
      const last=Number(localStorage.getItem(key)||0);
      if(Date.now()-last < 7*24*60*60*1000) return;
      const overlay=document.createElement('div'); overlay.className='pv-tg-overlay'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label',c.title);
      overlay.innerHTML=`<div class="pv-tg-card"><button class="pv-tg-close" aria-label="Close">×</button><div class="pv-tg-icon">➤</div><h2>${c.title}</h2><p>${c.copy}</p><div class="pv-tg-actions"><a class="pv-tg-join" href="${c.telegram}" target="_blank" rel="noopener noreferrer">${c.join}</a><button class="pv-tg-later">${c.later}</button></div><small class="pv-tg-note">${c.brand}</small></div>`;
      document.body.appendChild(overlay);
      const close=()=>{localStorage.setItem(key,String(Date.now()));overlay.classList.remove('is-open');setTimeout(()=>overlay.remove(),250)};
      overlay.querySelector('.pv-tg-close').addEventListener('click',close); overlay.querySelector('.pv-tg-later').addEventListener('click',close); overlay.querySelector('.pv-tg-join').addEventListener('click',close); overlay.addEventListener('click',e=>{if(e.target===overlay)close()});
      setTimeout(()=>overlay.classList.add('is-open'),1100);
    })();
    </script>
    <?php
}, 100);
