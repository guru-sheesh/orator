"""Pre-transcribes the built-in shadowing clips with Whisper (runs locally, no Azure quota).

Writes public/audio/transcripts/<clip id>.json as {"text": ..., "words": [{text, start, end, punct?}]},
the same shape the app stores for clip transcripts. Skips clips already done, so it can be resumed.

Usage (from the project folder):
  <venv>\\Scripts\\python.exe tools/transcribe-clips.py [--limit N] [--model small.en]
Needs: pip install faster-whisper
"""
import argparse, json, os, re, sys, time
from faster_whisper import WhisperModel

ap = argparse.ArgumentParser()
ap.add_argument('--limit', type=int, default=0)
ap.add_argument('--model', default='small.en')
args = ap.parse_args()

catalogue = json.load(open('public/audio/clips.json', encoding='utf-8'))
out_dir = os.path.join('public', 'audio', 'transcripts')
os.makedirs(out_dir, exist_ok=True)

todo = [c for c in catalogue['clips'] if not os.path.exists(os.path.join(out_dir, c['id'] + '.json'))]
if args.limit:
    todo = todo[: args.limit]
print(f'{len(todo)} clips to transcribe with {args.model}', flush=True)

model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=os.cpu_count() or 4)
PUNCT = re.compile(r'^(.*?)([.,!?;:]*)$')
started = time.time()

for n, clip in enumerate(todo, 1):
    path = os.path.join('public', clip['file'].lstrip('/'))
    t0 = time.time()
    segments, _ = model.transcribe(path, language='en', word_timestamps=True, beam_size=5, vad_filter=False, condition_on_previous_text=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            token = w.word.strip()
            if not token:
                continue
            # Pieces without a leading space continue the previous word ("D" + ".C." -> "D.C.").
            if words and not w.word.startswith(' '):
                prev = words[-1]
                merged = prev['text'] + prev.pop('punct', '') + token
                text, punct = PUNCT.match(merged).groups()
                prev['text'], prev['end'] = text, round(w.end, 2)
                if punct:
                    prev['punct'] = punct
                continue
            text, punct = PUNCT.match(token).groups()
            if not text:  # stray punctuation: attach to the previous word
                if words:
                    words[-1]['punct'] = (words[-1].get('punct') or '') + punct
                continue
            word = {'text': text, 'start': round(w.start, 2), 'end': round(w.end, 2)}
            if punct:
                word['punct'] = punct
            words.append(word)
    text = ' '.join(w['text'] + w.get('punct', '') for w in words)
    with open(os.path.join(out_dir, clip['id'] + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'text': text, 'words': words}, f, ensure_ascii=False, separators=(',', ':'))
    elapsed = time.time() - started
    eta = elapsed / n * (len(todo) - n)
    print(f'{n}/{len(todo)}  {time.time() - t0:5.1f}s  {len(words):3d} words  eta {eta / 60:5.1f} min  {clip["id"]}', flush=True)
