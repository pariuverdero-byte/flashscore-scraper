<?php
if (PHP_SAPI !== 'cli') exit(1);
umask(0077);

try {
    $config = json_decode(file_get_contents(dirname(__DIR__) . '/pariuverde-watchdog/config.json'), true, 512, JSON_THROW_ON_ERROR);
    $token = trim($config['github_token'] ?? '');
    if ($token === '') throw new RuntimeException('GitHub Actions token missing.');
    $month = (new DateTimeImmutable('now', new DateTimeZone('Europe/Bucharest')))
        ->modify('first day of last month')->format('Y-m');
    $reportFile = __DIR__ . "/report-$month.json";
    $report = is_file($reportFile) ? json_decode(file_get_contents($reportFile), true) : [];
    $check = in_array('--check', $argv, true);
    if (!$check && !empty($report['delivered'])) exit(0);

    $base = 'https://api.github.com/repos/pariuverdero-byte/flashscore-scraper/actions/workflows/live-calibration-report.yml';
    $curl = curl_init($check ? $base : "$base/dispatches");
    $options = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => 'PariuVerde-Calibration-Hosting',
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Content-Type: application/json',
            'Accept: application/vnd.github+json', 'X-GitHub-Api-Version: 2022-11-28'],
    ];
    if (!$check) $options += [CURLOPT_POST => true, CURLOPT_POSTFIELDS => '{"ref":"main"}'];
    curl_setopt_array($curl, $options);
    $body = curl_exec($curl);
    $status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    if ($body === false || $status !== ($check ? 200 : 204)) throw new RuntimeException("GitHub returned HTTP $status.");
    if ($check) {
        $workflow = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
        if (($workflow['state'] ?? '') !== 'active') throw new RuntimeException('Monthly workflow is inactive.');
        echo "Monthly workflow active; GitHub read check OK.\n";
    } else {
        echo "GitHub accepted the calibration run for $month.\n";
    }
} catch (Throwable $error) {
    fwrite(STDERR, 'Calibration: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}
