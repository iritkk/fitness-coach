"""
Garmin Connect API - Python Serverless Function
Verwendet garminconnect library für zuverlässigen Sync
"""

from http.server import BaseHTTPRequestHandler
import json
import os
from datetime import datetime, timedelta

# Vercel KV für Token-Storage (oder Fallback auf File)
try:
    from garminconnect import Garmin, GarminConnectAuthenticationError
    GARMIN_AVAILABLE = True
except ImportError:
    GARMIN_AVAILABLE = False


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Health check endpoint"""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        response = {
            'status': 'ok',
            'garmin_library': GARMIN_AVAILABLE,
            'timestamp': datetime.now().isoformat()
        }
        self.wfile.write(json.dumps(response).encode())

    def do_POST(self):
        """
        Sync Garmin data
        Body: { "email": "...", "password": "..." }
        Returns: { "success": true, "data": { sleep, hrv, bodyBattery, ... } }
        """
        self.send_header('Access-Control-Allow-Origin', '*')

        if not GARMIN_AVAILABLE:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'garminconnect library not available'
            }).encode())
            return

        # Parse request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
            email = data.get('email')
            password = data.get('password')

            if not email or not password:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': 'Email and password required'
                }).encode())
                return

            # Initialize Garmin client
            garmin = Garmin(email, password)

            try:
                garmin.login()
            except GarminConnectAuthenticationError as e:
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'error': f'Authentication failed: {str(e)}'
                }).encode())
                return

            # Fetch today's data
            today = datetime.now().strftime('%Y-%m-%d')
            yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

            result_data = {
                'lastSync': datetime.now().isoformat(),
                'sleepHours': None,
                'sleepScore': None,
                'bodyBattery': None,
                'hrv': None,
                'hrvAvg7d': None,
                'restingHR': None,
                'steps': None,
                'stressLevel': None
            }

            # Get sleep data
            try:
                sleep_data = garmin.get_sleep_data(today)
                if sleep_data:
                    sleep_seconds = sleep_data.get('dailySleepDTO', {}).get('sleepTimeSeconds', 0)
                    result_data['sleepHours'] = round(sleep_seconds / 3600, 1) if sleep_seconds else None
                    result_data['sleepScore'] = sleep_data.get('dailySleepDTO', {}).get('sleepScores', {}).get('overall', {}).get('value')
            except Exception as e:
                print(f"Sleep data error: {e}")

            # Get HRV data
            try:
                hrv_data = garmin.get_hrv_data(today)
                if hrv_data:
                    result_data['hrv'] = hrv_data.get('hrvSummary', {}).get('lastNightAvg')
                    result_data['hrvAvg7d'] = hrv_data.get('hrvSummary', {}).get('weeklyAvg')
            except Exception as e:
                print(f"HRV data error: {e}")

            # Get body battery
            try:
                bb_data = garmin.get_body_battery(today)
                if bb_data and len(bb_data) > 0:
                    latest = bb_data[-1] if isinstance(bb_data, list) else bb_data
                    result_data['bodyBattery'] = latest.get('bodyBatteryLevel') or latest.get('charged')
            except Exception as e:
                print(f"Body battery error: {e}")

            # Get resting heart rate
            try:
                hr_data = garmin.get_rhr_day(today)
                if hr_data:
                    result_data['restingHR'] = hr_data.get('restingHeartRate')
            except Exception as e:
                print(f"RHR data error: {e}")

            # Get steps from yesterday
            try:
                steps_data = garmin.get_steps_data(yesterday)
                if steps_data:
                    result_data['steps'] = steps_data.get('totalSteps')
            except Exception as e:
                print(f"Steps data error: {e}")

            # Get stress level
            try:
                stress_data = garmin.get_stress_data(today)
                if stress_data:
                    result_data['stressLevel'] = stress_data.get('overallStressLevel')
            except Exception as e:
                print(f"Stress data error: {e}")

            # Success response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'data': result_data
            }).encode())

        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': 'Invalid JSON'
            }).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': str(e)
            }).encode())
