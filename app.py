from flask import Flask, render_template, request, jsonify, send_from_directory
import subprocess
import json
import os
import threading
from pathlib import Path
import time

app = Flask(__name__)

PROJECT_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = PROJECT_DIR / 'templates'
STATIC_DIR = PROJECT_DIR / 'static'
SCRIPTS_DIR = PROJECT_DIR / 'scripts'
OUTPUT_DIR = PROJECT_DIR / 'output'

TEMPLATES_DIR.mkdir(exist_ok=True)
STATIC_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

running_processes = {}

@app.route('/')
def index():
    """Serve the main character selection interface"""
    return render_template('character_selection.html')

@app.route('/data/<path:filename>')
def serve_data(filename):
    """Serve files from the data directory"""
    return send_from_directory('data', filename)

@app.route('/env/<path:filename>')
def serve_env(filename):
    """Serve HDRI files from the static/env directory"""
    env_dir = STATIC_DIR / 'env'
    return send_from_directory(env_dir, filename)

@app.route('/api/generate', methods=['POST'])
def generate_animation():
    """Handle animation generation request"""
    try:
        data = request.get_json()
        
        required_fields = ['participant', 'movement', 'setType', 'camera', 'fps', 'saveName']
        if not all(field in data for field in required_fields):
            return jsonify({'error': 'Missing required fields'}), 400
        
        job_id = f"{data['participant']}_{data['movement']}_{int(time.time())}"
        
        # Start Blender process
        thread = threading.Thread(
            target=run_blender_process, 
            args=(data, job_id)
        )
        thread.start()
        
        # Store process info
        running_processes[job_id] = {
            'status': 'running',
            'thread': thread,
            'config': data,
            'start_time': time.time()
        }
        
        return jsonify({
            'success': True,
            'job_id': job_id,
            'message': 'Animation generation started'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/status/<job_id>')
def get_status(job_id):
    """Get status of a running job"""
    if job_id not in running_processes:
        return jsonify({'error': 'Job not found'}), 404
    
    job = running_processes[job_id]
    
    #check if thread is still running
    if job['thread'].is_alive():
        status = 'running'
    else:
        output_file = OUTPUT_DIR / f"{job['config']['saveName']}.mp4"
        if output_file.exists():
            status = 'completed'
        else:
            status = 'failed'
        
        job['status'] = status
    
    return jsonify({
        'job_id': job_id,
        'status': job['status'],
        'runtime': time.time() - job['start_time']
    })

@app.route('/api/download/<filename>')
def download_file(filename):
    """Download generated animation file"""
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except FileNotFoundError:
        return jsonify({'error': 'File not found'}), 404

def run_blender_process(data, job_id):
    """Run Blender process in subprocess"""
    try:
        #Blender cmd
        blender_cmd = [
            'blender',
            '--python', str(SCRIPTS_DIR / 'process_one.py'),
            '--',
            str(data['participant']),
            str(data['movement']), 
            str(data['setType']),
            str(data['camera']),
            str(data['fps']),
            str(data['saveName']),
        ]
        
        result = subprocess.run(
            blender_cmd,
            cwd=PROJECT_DIR,
            capture_output=True,
            text=True,
            timeout=1200 
        )
        
        #Log
        with open(PROJECT_DIR / f"log_{job_id}.txt", 'w') as f:
            f.write(f"Return code: {result.returncode}\n")
            f.write(f"STDOUT:\n{result.stdout}\n")
            f.write(f"STDERR:\n{result.stderr}\n")
        
        if result.returncode == 0:
            print(f"Job {job_id} completed successfully")
            running_processes[job_id]['status'] = 'completed'
        else:
            print(f"Job {job_id} failed with code {result.returncode}")
            running_processes[job_id]['status'] = 'failed'
            
    except subprocess.TimeoutExpired:
        print(f"Job {job_id} timed out")
        running_processes[job_id]['status'] = 'timeout'
    except Exception as e:
        print(f"Job {job_id} crashed: {e}")
        running_processes[job_id]['status'] = 'error'

if __name__ == '__main__':
    print("Starting Character Selection Web Server")
    print(f"Project Directory: {PROJECT_DIR}")
    print(f"Output Directory: {OUTPUT_DIR}")
    app.run(host='0.0.0.0', port=5000, debug=True)