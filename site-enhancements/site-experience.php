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
        'facebook' => 'https://www.facebook.com/profile.php?id=61593989710772',
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
        'facebook' => 'https://www.facebook.com/profile.php?id=61594437740933',
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
      .elementor-element[data-id="6079c56f"] .elementor-social-icon{width:50px!important;height:50px!important;min-width:50px!important;min-height:50px!important;padding:0!important;border-radius:6px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;font-size:21px!important;line-height:1!important}
      .elementor-element[data-id="6079c56f"] .elementor-social-icon svg{width:21px!important;height:21px!important;display:block!important}
      .elementor-element[data-id="6079c56f"] .elementor-grid-item{display:inline-flex!important;align-items:center!important;justify-content:center!important}
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
      const addSocial=(network,url,color,path)=>{
        if(!socialWrap || socialWrap.querySelector(`.pv-social-${network}`) || socialWrap.querySelector(`.elementor-social-icon-${network}`)) return;
        const item=document.createElement('span'); item.className=`elementor-grid-item pv-social-${network}`; item.setAttribute('role','listitem');
        item.innerHTML=`<a class="elementor-icon elementor-social-icon" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${network[0].toUpperCase()+network.slice(1)}" style="background:${color};color:#fff"><span class="elementor-screen-only">${network}</span><svg aria-hidden="true" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg" style="width:1em;height:1em;fill:currentColor"><path d="${path}"></path></svg></a>`;
        socialWrap.appendChild(item);
      };
      addSocial('instagram',c.instagram,'#c13584','M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8z');
      addSocial('tiktok',c.tiktok,'#111','M448 209.9a210.1 210.1 0 0 1-122.8-39.3v178.7A162.6 162.6 0 1 1 185 188v89.9a74.6 74.6 0 1 0 52.2 71.3V0h88a121.2 121.2 0 0 0 1.9 22.2A122.2 122.2 0 0 0 381 102.4a121.4 121.4 0 0 0 67 20.1z');
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
