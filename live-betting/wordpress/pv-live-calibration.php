<?php
/**
 * Plugin Name: PariuVerde Live Calibration
 * Description: Private signal history and monthly calibration review.
 */
if (!defined('ABSPATH')) exit;

function pv_cal_directory() {
    return dirname(rtrim(ABSPATH, '/')) . '/pariuverde-live-history';
}

function pv_cal_read($name) {
    $file = pv_cal_directory() . '/' . $name;
    if (!is_readable($file)) return null;
    $raw = file_get_contents($file);
    return $raw === false ? null : json_decode($raw, true);
}

function pv_cal_month($preview = false) {
    $now = new DateTimeImmutable('now', new DateTimeZone('Europe/Bucharest'));
    $month = $now->modify('first day of this month');
    return ($preview ? $month : $month->modify('-1 month'))->format('Y-m');
}

function pv_cal_local($timestamp, $format) {
    if (!is_string($timestamp) || $timestamp === '') return '';
    $date = date_create_immutable($timestamp);
    return $date ? $date->setTimezone(new DateTimeZone('Europe/Bucharest'))->format($format) : '';
}

function pv_cal_summary($rows) {
    $outcomes = ['won', 'lost', 'pending', 'unverified', 'no_more_goals'];
    $empty = array_fill_keys($outcomes, 0);
    $counts = $empty;
    $groups = ['market' => [], 'market_minute' => [], 'market_confidence' => []];
    $markets = ['goal_after_signal', 'match_goals_over', 'match_corners_over', 'home_next_goal', 'away_next_goal'];
    foreach ($rows as $row) {
        $market = in_array($row['market'] ?? '', $markets, true) ? $row['market'] : 'unclassified';
        $outcome = in_array($row['outcome'] ?? '', $outcomes, true) ? $row['outcome'] : 'unverified';
        $minute = isset($row['minute']) && preg_match('/^\d+(?:\+\d+)?$/D', (string) $row['minute']) ? (int) $row['minute'] : null;
        $band = $minute === null ? 'unknown' : ($minute < 45 ? '0–44' : ($minute < 60 ? '45–59' : ($minute < 75 ? '60–74' : '75+')));
        $confidence = is_numeric($row['confidence'] ?? null) ? (int) $row['confidence'] : null;
        $grade = $confidence === null ? 'unknown' : ($confidence < 70 ? '<70' : ($confidence < 85 ? '70–84' : '85+'));
        ++$counts[$outcome];
        foreach (['market' => $market, 'market_minute' => "$market / $band", 'market_confidence' => "$market / $grade"] as $axis => $key) {
            if (!isset($groups[$axis][$key])) $groups[$axis][$key] = $empty;
            ++$groups[$axis][$key][$outcome];
        }
    }
    return ['episodes' => count($rows), 'outcomes' => $counts, 'groups' => $groups];
}

function pv_cal_rows($history, $month) {
    return array_values(array_filter($history['records'] ?? [], function ($row) use ($month) {
        return ($row['site'] ?? '') === 'pariuverde.ro' &&
            pv_cal_local($row['firstSeenAt'] ?? '', 'Y-m') === $month;
    }));
}

function pv_cal_pair($pair) {
    return is_array($pair) && count($pair) === 2 ? implode('–', array_map('intval', $pair)) : '—';
}

add_action('admin_menu', function () {
    add_management_page('Semnale live', 'Semnale live', 'manage_options', 'pv-live-calibration', 'pv_cal_dashboard');
});

function pv_cal_dashboard() {
    if (!current_user_can('manage_options')) wp_die('Acces restricționat.', '', ['response' => 403]);
    $history = pv_cal_read('history.json');
    $month = isset($_GET['month']) && is_string($_GET['month']) && preg_match('/^\d{4}-(?:0[1-9]|1[0-2])$/D', $_GET['month'])
        ? $_GET['month'] : pv_cal_month(true);
    $rows = array_reverse(pv_cal_rows($history ?? [], $month));
    $summary = pv_cal_summary($rows);
    $counts = $summary['outcomes'];
    $offset = max(0, (max(1, (int) ($_GET['pg'] ?? 1)) - 1) * 50);
    $labels = ['won' => 'Câștigat', 'lost' => 'Pierdut', 'pending' => 'În așteptare',
        'unverified' => 'Neconfirmat', 'no_more_goals' => 'Fără alt gol'];
    $report = pv_cal_read("report-$month.json");
    $period = pv_cal_local($history['lastFeed']['pariuverde.ro'] ?? '', 'd.m.Y H:i');
    ?>
    <div class="wrap pv-cal">
      <style>
        .pv-cal{max-width:1500px}.pv-cal form{display:flex;align-items:center;gap:10px;margin:18px 0;flex-wrap:wrap}
        .pv-cal-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:12px;margin:18px 0}
        .pv-cal-stats div{background:#fff;border:1px solid #dcdcde;border-left:4px solid #00865a;padding:14px}
        .pv-cal-stats strong{display:block;font-size:1.55rem;margin-bottom:8px}
        .pv-cal-table{overflow:auto}.pv-cal-table td{vertical-align:top}.pv-cal-table a{white-space:nowrap}
        .pv-cal-report{white-space:pre-wrap;background:#fff;border:1px solid #dcdcde;padding:16px}
      </style>
      <h1>Semnale live</h1>
      <p>PariuVerde.ro · Ultima captură: <?php echo esc_html($period ?: 'indisponibilă'); ?>, ora României</p>
      <?php if (!is_array($history)): ?><div class="notice notice-warning inline"><p>Jurnalul nu este disponibil.</p></div><?php endif; ?>
      <form method="get"><input type="hidden" name="page" value="pv-live-calibration">
        <label for="pv-live-month">Luna</label>
        <input type="month" name="month" id="pv-live-month" value="<?php echo esc_attr($month); ?>">
        <button class="button">Afișează</button>
      </form>
      <div class="pv-cal-stats">
        <?php foreach (['Semnale observate' => count($rows)] + array_combine(array_values($labels), array_values($counts)) as $name => $value): ?>
          <div><strong><?php echo esc_html((string) $value); ?></strong><?php echo esc_html($name); ?></div>
        <?php endforeach; ?>
      </div>
      <h2>Istoricul semnalelor</h2>
      <p>Intervalul este măsurat din capturile feedului. Verifică separat rezultatul pieței și scorul final.</p>
      <div class="pv-cal-table"><table class="widefat striped">
        <thead><tr><th>Partidă</th><th>Semnal</th><th>Prima → ultima observare</th><th>Scor inițial → final</th><th>Rezultat</th></tr></thead>
        <tbody>
        <?php foreach (array_slice($rows, $offset, 50) as $row): ?>
          <tr>
            <td><strong><?php echo esc_html(implode(' – ', $row['teams'] ?? [])); ?></strong><br><?php echo esc_html($row['competition'] ?? ''); ?></td>
            <td><?php echo esc_html($row['title'] ?? ''); ?><br>
              Încredere <?php echo esc_html((string) ($row['confidence'] ?? '—')); ?> · Cotă min. <?php echo esc_html((string) ($row['minimumOdd'] ?? '—')); ?>
              <?php if (!empty($row['stats']) && is_array($row['stats'])): ?><details><summary>Date la prima observare</summary>
                <p><?php echo esc_html($row['reason'] ?? ''); ?></p>
                <?php foreach ($row['stats'] as $label => $stat): ?><div><?php echo esc_html("$label: $stat"); ?></div><?php endforeach; ?>
              </details><?php endif; ?>
            </td>
            <td><?php echo esc_html(pv_cal_local($row['firstSeenAt'] ?? '', 'd.m H:i:s') . ' → ' . pv_cal_local($row['lastSeenAt'] ?? '', 'H:i:s')); ?><br>
              <?php echo esc_html(($row['minute'] ?? '—') . '′ → ' . ($row['lastSeenMinute'] ?? '—') . '′'); ?></td>
            <td><?php echo esc_html(pv_cal_pair($row['scoreAtSignal'] ?? null) . ' → ' . pv_cal_pair($row['finalScore'] ?? null)); ?>
              <?php if (isset($row['finalCorners'])): ?><br><?php echo esc_html($row['finalCorners'] . ' cornere'); ?><?php endif; ?></td>
            <td><?php echo esc_html($labels[$row['outcome'] ?? ''] ?? 'Neconfirmat'); ?>
              <?php if (!empty($row['resultUrl'])): ?><br><a href="<?php echo esc_url($row['resultUrl']); ?>" rel="noopener">Flashscore</a><?php endif; ?></td>
          </tr>
        <?php endforeach; ?>
        <?php if (!$rows): ?><tr><td colspan="5">Nu există semnale înregistrate pentru această lună.</td></tr><?php endif; ?>
        </tbody>
      </table></div>
      <?php if ($offset > 0 || $offset + 50 < count($rows)): ?><p>
        <?php foreach (['Înapoi' => $offset / 50, 'Mai departe' => $offset / 50 + 2] as $label => $number):
            if ($number < 1 || ($number - 1) * 50 >= count($rows)) continue; ?>
          <a class="button" href="<?php echo esc_url(add_query_arg(['page' => 'pv-live-calibration', 'month' => $month, 'pg' => $number], admin_url('tools.php'))); ?>"><?php echo esc_html($label); ?></a>
        <?php endforeach; ?></p><?php endif; ?>
      <h2>Recomandarea lunară</h2>
      <?php if (!empty($report['text'])): ?><div class="pv-cal-report"><?php echo esc_html($report['text']); ?></div>
      <?php else: ?><p>Nu există încă un raport pentru luna selectată.</p><?php endif; ?>
    </div>
    <?php
}

add_action('rest_api_init', function () {
    register_rest_route('pv-live-calibration/v1', '/monthly', [
        [
            'methods' => 'GET',
            'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => function ($request) {
                $history = pv_cal_read('history.json');
                if (!is_array($history) || !is_array($history['records'] ?? null)) {
                    return new WP_Error('pv_history_missing', 'Jurnal indisponibil.', ['status' => 503]);
                }
                $month = pv_cal_month($request->get_param('preview') === '1');
                $report = pv_cal_read("report-$month.json");
                return rest_ensure_response([
                    'month' => $month,
                    'summary' => pv_cal_summary(pv_cal_rows($history, $month)),
                    'delivered' => !empty($report['delivered']),
                    'has_analysis' => !empty($report['text']),
                ]);
            },
        ],
        ['methods' => 'POST', 'permission_callback' => function () { return current_user_can('manage_options'); },
            'callback' => 'pv_cal_deliver'],
    ]);
});

function pv_cal_deliver($request) {
    $month = pv_cal_month();
    $text = $request->get_param('text');
    if ($request->get_param('month') !== $month || !is_string($text) || strlen($text) > 18000) {
        return new WP_Error('pv_invalid_report', 'Raport invalid.', ['status' => 400]);
    }
    $recipients = pv_cal_read('mail-recipients.json');
    if (!is_array($recipients) || !$recipients || count(array_filter($recipients, 'is_email')) !== count($recipients)) {
        return new WP_Error('pv_mail_config', 'Destinatarii nu sunt configurați.', ['status' => 503]);
    }
    $directory = pv_cal_directory();
    $lock = fopen("$directory/report.lock", 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        return new WP_Error('pv_report_busy', 'Se procesează deja un raport.', ['status' => 409]);
    }
    try {
        $name = "report-$month.json";
        $report = pv_cal_read($name) ?? ['text' => trim($text), 'sent' => [], 'delivered' => false];
        if ($report['delivered']) return ['delivered' => true];
        if ($report['text'] === '') return new WP_Error('pv_empty_report', 'Raport gol.', ['status' => 400]);
        $save = function () use (&$report, $directory, $name) {
            $file = "$directory/$name";
            return file_put_contents("$file.tmp", wp_json_encode($report, JSON_UNESCAPED_UNICODE)) !== false &&
                rename("$file.tmp", $file);
        };
        if (!$save()) return new WP_Error('pv_report_write', 'Raportul nu a putut fi salvat.', ['status' => 503]);
        $url = admin_url('tools.php?page=pv-live-calibration&month=' . $month);
        foreach (array_unique($recipients) as $recipient) {
            if (in_array($recipient, $report['sent'], true)) continue;
            if (!wp_mail($recipient, "PariuVerde · Recalibrare semnale live · $month", $report['text'] . "\n\nIstoric: $url")) {
                return new WP_Error('pv_mail_error', 'WordPress nu a acceptat e-mailul.', ['status' => 502]);
            }
            $report['sent'][] = $recipient;
            if (!$save()) return new WP_Error('pv_report_write', 'Livrarea nu a putut fi consemnată.', ['status' => 503]);
        }
        $report['delivered'] = true;
        if (!$save()) return new WP_Error('pv_report_write', 'Livrarea nu a putut fi consemnată.', ['status' => 503]);
        return ['delivered' => true];
    } finally {
        fclose($lock);
    }
}
