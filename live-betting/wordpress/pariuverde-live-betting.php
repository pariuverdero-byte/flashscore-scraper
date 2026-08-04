<?php
/**
 * Plugin Name: PariuVerde / GreenBetTips Live Betting
 * Description: Receives and displays the central live betting feed.
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) exit;

const PV_LIVE_OPTION = 'pv_live_betting_feed';
const PV_LIVE_TOKEN_OPTION = 'pv_live_betting_token';

register_activation_hook(__FILE__, function () {
    if (!get_option(PV_LIVE_TOKEN_OPTION)) {
        update_option(PV_LIVE_TOKEN_OPTION, wp_generate_password(40, false, false));
    }
});

add_action('rest_api_init', function () {
    register_rest_route('pv-live/v1', '/feed', [
        'methods' => 'POST',
        'callback' => function (WP_REST_Request $request) {
            $provided = $request->get_header('x-pv-live-token');
            $expected = (string) get_option(PV_LIVE_TOKEN_OPTION);
            if (!$provided || !$expected || !hash_equals($expected, $provided)) {
                return new WP_Error('forbidden', 'Invalid live feed token.', ['status' => 403]);
            }
            $payload = $request->get_json_params();
            if (!is_array($payload) || empty($payload['generatedAt']) || !isset($payload['matches'])) {
                return new WP_Error('invalid_feed', 'Invalid feed payload.', ['status' => 400]);
            }
            update_option(PV_LIVE_OPTION, $payload, false);
            return ['ok' => true, 'matches' => count($payload['matches'])];
        },
        'permission_callback' => '__return_true',
    ]);
});

function pv_live_lang($atts) {
    if (!empty($atts['lang'])) return $atts['lang'] === 'en' ? 'en' : 'ro';
    return str_starts_with(get_locale(), 'en') ? 'en' : 'ro';
}

function pv_live_num($value) { return esc_html(number_format_i18n((float)$value, 0)); }

add_shortcode('pv_live_betting', function ($atts = []) {
    $atts = shortcode_atts(['lang' => ''], $atts);
    $lang = pv_live_lang($atts);
    $feed = get_option(PV_LIVE_OPTION, []);
    $matches = is_array($feed['matches'] ?? null) ? $feed['matches'] : [];
    $t = $lang === 'en' ? [
        'title' => 'Live Betting Signals', 'empty' => 'There are no monitored live matches right now.',
        'shots' => 'Shots', 'sot' => 'On target', 'corners' => 'Corners', 'possession' => 'Possession',
        'confidence' => 'Confidence', 'minimum' => 'Minimum suggested odds', 'updated' => 'Updated', 'active' => 'ACTIVE SIGNAL',
    ] : [
        'title' => 'Semnale Live Betting', 'empty' => 'Nu există momentan meciuri live monitorizate.',
        'shots' => 'Șuturi', 'sot' => 'Pe poartă', 'corners' => 'Cornere', 'possession' => 'Posesie',
        'confidence' => 'Încredere', 'minimum' => 'Cotă minimă recomandată', 'updated' => 'Actualizat', 'active' => 'SEMNAL ACTIV',
    ];

    ob_start(); ?>
    <div class="pv-live-wrap" data-refresh="<?php echo esc_attr((int)($feed['refreshSeconds'] ?? 75)); ?>">
      <div class="pv-live-head"><h2><?php echo esc_html($t['title']); ?></h2><span class="pv-live-dot"></span></div>
      <?php if (!$matches): ?><p><?php echo esc_html($t['empty']); ?></p><?php endif; ?>
      <div class="pv-live-grid">
      <?php foreach ($matches as $match):
        $h = $match['stats']['home'] ?? []; $a = $match['stats']['away'] ?? []; ?>
        <article class="pv-live-card">
          <div class="pv-live-meta"><strong>LIVE · <?php echo esc_html(($match['minute'] ?? '?') . "'"); ?></strong><span><?php echo esc_html($match['competition'] ?? ''); ?></span></div>
          <div class="pv-live-score"><span><?php echo esc_html($match['home'] ?? ''); ?></span><b><?php echo pv_live_num($match['score']['home'] ?? 0); ?>–<?php echo pv_live_num($match['score']['away'] ?? 0); ?></b><span><?php echo esc_html($match['away'] ?? ''); ?></span></div>
          <div class="pv-live-stats">
            <div><small><?php echo esc_html($t['shots']); ?></small><b><?php echo pv_live_num($h['shots'] ?? 0); ?>–<?php echo pv_live_num($a['shots'] ?? 0); ?></b></div>
            <div><small><?php echo esc_html($t['sot']); ?></small><b><?php echo pv_live_num($h['shotsOnTarget'] ?? 0); ?>–<?php echo pv_live_num($a['shotsOnTarget'] ?? 0); ?></b></div>
            <div><small><?php echo esc_html($t['corners']); ?></small><b><?php echo pv_live_num($h['corners'] ?? 0); ?>–<?php echo pv_live_num($a['corners'] ?? 0); ?></b></div>
            <div><small><?php echo esc_html($t['possession']); ?></small><b><?php echo pv_live_num($h['possession'] ?? 0); ?>%–<?php echo pv_live_num($a['possession'] ?? 0); ?>%</b></div>
          </div>
          <?php foreach (($match['signals'] ?? []) as $signal): ?>
          <div class="pv-live-signal">
            <span><?php echo esc_html($t['active']); ?></span>
            <h3><?php echo esc_html($signal['title'][$lang] ?? ''); ?><?php echo isset($signal['line']) ? ' ' . esc_html($signal['line']) : ''; ?></h3>
            <p><?php echo esc_html($signal['reason'][$lang] ?? ''); ?></p>
            <div><b><?php echo esc_html($t['confidence']); ?>: <?php echo pv_live_num($signal['confidence'] ?? 0); ?>/100</b><em><?php echo esc_html($t['minimum']); ?>: <?php echo esc_html(number_format_i18n((float)($signal['recommendedMinimumOdd'] ?? 0), 2)); ?></em></div>
          </div>
          <?php endforeach; ?>
        </article>
      <?php endforeach; ?>
      </div>
      <p class="pv-live-updated"><?php echo esc_html($t['updated']); ?>: <?php echo esc_html($feed['generatedAt'] ?? '-'); ?></p>
    </div>
    <style>
    .pv-live-wrap{font-family:inherit;max-width:1200px;margin:auto}.pv-live-head{display:flex;align-items:center;gap:10px}.pv-live-dot{width:10px;height:10px;border-radius:50%;background:#e32636;box-shadow:0 0 0 5px rgba(227,38,54,.12)}.pv-live-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}.pv-live-card{border:1px solid #dde3e8;border-radius:14px;padding:18px;background:#fff;box-shadow:0 5px 20px rgba(0,0,0,.05)}.pv-live-meta{display:flex;justify-content:space-between;font-size:13px}.pv-live-meta strong{color:#e32636}.pv-live-score{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin:18px 0;text-align:center}.pv-live-score b{font-size:25px}.pv-live-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.pv-live-stats div{text-align:center;background:#f5f7f8;border-radius:8px;padding:8px 4px}.pv-live-stats small,.pv-live-stats b{display:block}.pv-live-signal{margin-top:16px;border-left:4px solid #1f8f4e;background:#eef9f2;padding:13px;border-radius:8px}.pv-live-signal>span{font-size:11px;font-weight:800;color:#1f8f4e}.pv-live-signal h3{margin:5px 0}.pv-live-signal p{margin:5px 0 10px}.pv-live-signal div{display:flex;justify-content:space-between;gap:8px;font-size:13px}.pv-live-signal em{font-style:normal}.pv-live-updated{font-size:12px;opacity:.65;margin-top:12px}@media(max-width:520px){.pv-live-stats{grid-template-columns:repeat(2,1fr)}.pv-live-signal div{display:block}}
    </style>
    <?php return ob_get_clean();
});

add_action('admin_menu', function () {
    add_options_page('Live Betting', 'Live Betting', 'manage_options', 'pv-live-betting', function () {
        echo '<div class="wrap"><h1>Live Betting</h1><p><strong>Endpoint:</strong> ' . esc_html(rest_url('pv-live/v1/feed')) . '</p><p><strong>Token:</strong> <code>' . esc_html(get_option(PV_LIVE_TOKEN_OPTION)) . '</code></p><p><strong>Shortcode RO:</strong> <code>[pv_live_betting lang="ro"]</code></p><p><strong>Shortcode EN:</strong> <code>[pv_live_betting lang="en"]</code></p></div>';
    });
});
