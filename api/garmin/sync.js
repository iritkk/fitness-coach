// Vercel Serverless Function for Garmin Connect
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Credentials required' });

    try {
        const sso = await fetch('https://sso.garmin.com/sso/signin?service=https://connect.garmin.com/modern', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const cookies = sso.headers.get('set-cookie') || '';
        const html = await sso.text();
        const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1] || '';

        const login = await fetch('https://sso.garmin.com/sso/signin?service=https://connect.garmin.com/modern', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies },
            body: new URLSearchParams({ username: email, password, embed: 'false', _csrf: csrf }),
            redirect: 'manual',
        });

        const ticket = ((await login.text()).match(/ticket=([^"&]+)/) || [])[1];
        if (!ticket) return res.status(401).json({ error: 'Login failed' });

        const session = await fetch('https://connect.garmin.com/modern/?ticket=' + ticket, {
            headers: { 'Cookie': cookies + '; ' + (login.headers.get('set-cookie') || '') },
            redirect: 'manual',
        });
        const allCookies = cookies + '; ' + (session.headers.get('set-cookie') || '');

        const today = new Date().toISOString().split('T')[0];
        const get = async (url) => {
            try { const r = await fetch(url, { headers: { 'Cookie': allCookies, 'NK': 'NT' } }); return r.ok ? r.json() : null; }
            catch { return null; }
        };

        const [sleep, hrv, sum] = await Promise.all([
            get('https://connect.garmin.com/modern/proxy/wellness-service/wellness/dailySleepData/' + today),
            get('https://connect.garmin.com/modern/proxy/hrv-service/hrv/' + today),
            get('https://connect.garmin.com/modern/proxy/usersummary-service/usersummary/daily/' + today),
        ]);

        return res.status(200).json({ success: true, data: {
            sleepHours: sleep?.dailySleepDTO?.sleepTimeSeconds ? Math.round(sleep.dailySleepDTO.sleepTimeSeconds/360)/10 : null,
            hrv: hrv?.hrvSummary?.lastNightAvg, hrvAvg7d: hrv?.hrvSummary?.weeklyAvg,
            restingHR: sum?.restingHeartRate, bodyBattery: sum?.bodyBatteryChargedValue,
            steps: sum?.totalSteps, lastSync: new Date().toISOString()
        }});
    } catch (e) { return res.status(500).json({ error: e.message }); }
}
