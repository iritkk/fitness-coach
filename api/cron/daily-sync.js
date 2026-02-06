/**
 * Daily Cron Job - Runs at 8:00 CET (7:00 UTC)
 * 1. Fetches Garmin data
 * 2. Stores it for the day
 * 3. Triggers WhatsApp knee status question at 8:30
 */

// Vercel KV for storing data (or use environment variables for simple storage)
const GARMIN_DATA_KEY = 'garmin_daily_data';

export default async function handler(req, res) {
    // Verify this is a cron request (Vercel adds this header)
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // Allow in development or if no secret is set
        if (process.env.CRON_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    console.log('Daily sync started at:', new Date().toISOString());

    try {
        // Get stored credentials from environment variables
        const garminEmail = process.env.GARMIN_EMAIL;
        const garminPassword = process.env.GARMIN_PASSWORD;

        if (!garminEmail || !garminPassword) {
            console.error('Garmin credentials not configured');
            return res.status(500).json({
                error: 'Garmin credentials not configured',
                hint: 'Set GARMIN_EMAIL and GARMIN_PASSWORD in Vercel environment variables'
            });
        }

        // Call our Python Garmin API
        const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';

        const garminResponse = await fetch(`${baseUrl}/api/garmin/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: garminEmail,
                password: garminPassword
            })
        });

        const garminResult = await garminResponse.json();

        if (!garminResponse.ok) {
            console.error('Garmin sync failed:', garminResult.error);
            // Still continue to send WhatsApp - user can enter data manually
        } else {
            console.log('Garmin data fetched:', garminResult.data);
        }

        // Schedule WhatsApp message for 30 minutes later (8:30)
        // In production, use a proper queue or scheduled task
        // For now, we'll trigger it directly

        const whatsappNumber = process.env.WHATSAPP_USER_NUMBER;
        const whatsappToken = process.env.WHATSAPP_TOKEN;
        const whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;

        if (whatsappNumber && whatsappToken && whatsappPhoneId) {
            // Send WhatsApp knee status question
            await sendWhatsAppKneeQuestion(whatsappPhoneId, whatsappToken, whatsappNumber);
            console.log('WhatsApp message sent to:', whatsappNumber);
        } else {
            console.log('WhatsApp not configured, skipping message');
        }

        return res.status(200).json({
            success: true,
            garminData: garminResult.data || null,
            whatsappSent: !!(whatsappNumber && whatsappToken),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Daily sync error:', error);
        return res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Send WhatsApp knee status question via Meta Business API
 */
async function sendWhatsAppKneeQuestion(phoneId, token, to) {
    const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: to,
            type: 'interactive',
            interactive: {
                type: 'button',
                header: {
                    type: 'text',
                    text: 'Guten Morgen! âï¸'
                },
                body: {
                    text: 'Wie fÃ¼hlt sich dein Knie heute an?'
                },
                action: {
                    buttons: [
                        {
                            type: 'reply',
                            reply: {
                                id: 'knee_green',
                                title: 'ð¢ Alles gut'
                            }
                        },
                        {
                            type: 'reply',
                            reply: {
                                id: 'knee_yellow',
                                title: 'ð¡ Leicht'
                            }
                        },
                        {
                            type: 'reply',
                            reply: {
                                id: 'knee_red',
                                title: 'ð´ Schmerzen'
                            }
                        }
                    ]
                }
            }
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`WhatsApp API error: ${error}`);
    }

    return response.json();
}
