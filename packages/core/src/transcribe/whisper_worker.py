# Word-level transcription with faster-whisper (CTranslate2, CUDA when available), for the shared media library.
# Run with the venv under ~/.ae-compose/whisper-venv (Python 3.12):
#   python whisper_worker.py <media> <out.json> [--model large-v3-turbo] [--language en] [--device cuda|cpu]
# Writes { engine, model, language, duration, words: [{ text, start, end, p }], segments: [{ start, end, text }] }.
# Progress lines "progress <seconds done> <total>" go to stderr so the caller can report them.
import argparse
import json
import os
import sys
import time


def add_cuda_dlls():
    # The nvidia-cublas/cudnn wheels put their DLLs in site-packages/nvidia/*/bin; CTranslate2 needs them on the search path.
    base = os.path.join(sys.prefix, "Lib", "site-packages", "nvidia")
    if not os.path.isdir(base):
        return
    for name in os.listdir(base):
        b = os.path.join(base, name, "bin")
        if os.path.isdir(b):
            os.add_dll_directory(b)
            os.environ["PATH"] = b + os.pathsep + os.environ.get("PATH", "")


def decode(media):
    # ffmpeg (on PATH) decodes any container to 16 kHz mono float32, which is what Whisper wants; this avoids PyAV,
    # whose API moves under faster-whisper's feet.
    import subprocess
    import numpy as np
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", media, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if p.returncode != 0:
        raise SystemExit("ffmpeg could not decode " + media + ": " + p.stderr.decode("utf-8", "replace")[-400:])
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


# Whisper drops disfluencies unless the context shows them; this prompt keeps "um", "uh" and false starts in the text,
# which word-level tightening needs.
FILLER_PROMPT = "Umm, so, uh, let me think, like, hmm. I mean, I- I was, uh, you know, kind of thinking about it."


def load_model(name, device):
    add_cuda_dlls()
    from faster_whisper import WhisperModel
    compute = "float16" if device == "cuda" else "int8"
    try:
        return WhisperModel(name, device=device, compute_type=compute), device
    except Exception as e:  # no usable GPU: fall back to CPU
        print(f"warn cuda unavailable ({e}); using cpu", file=sys.stderr, flush=True)
        return WhisperModel(name, device="cpu", compute_type="int8"), "cpu"


def transcribe_one(model, model_name, device, media, out_path, language=None, fillers=True, load_s=0.0):
    t0 = time.time()
    audio = decode(media)
    segments, info = model.transcribe(
        audio,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        initial_prompt=FILLER_PROMPT if fillers else None,
        condition_on_previous_text=False,
        beam_size=5,
    )
    words, segs = [], []
    last = 0.0
    for s in segments:
        segs.append({"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()})
        for w in s.words or []:
            words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
        if s.end - last > 30:
            last = s.end
            print(f"progress {s.end:.1f} {info.duration:.1f}", file=sys.stderr, flush=True)
    out = {
        "engine": "faster-whisper",
        "model": model_name,
        "device": device,
        "language": info.language,
        "languageProbability": round(info.language_probability, 3),
        "duration": round(info.duration, 3),
        "seconds": {"load": round(load_s, 2), "total": round(time.time() - t0 + load_s, 2)},
        "words": words,
        "segments": segs,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, out_path)
    return len(words), out["seconds"]["total"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("media", nargs="?")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--model", default="large-v3-turbo")
    ap.add_argument("--language", default=None)
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--no-fillers", action="store_true")
    # --serve: keep the model loaded and read one JSON job per stdin line ({"media", "out", "language"?});
    # answers "done <out> <words>" or "error <out> <message>" per job on stdout (the library worker uses this).
    ap.add_argument("--serve", action="store_true")
    a = ap.parse_args()

    t0 = time.time()
    model, device = load_model(a.model, a.device)
    load_s = time.time() - t0
    if not a.serve:
        n, total = transcribe_one(model, a.model, device, a.media, a.out, a.language, not a.no_fillers, load_s)
        print(f"done {n} words in {total} s", file=sys.stderr, flush=True)
        return
    print("ready", flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = json.loads(line)
        try:
            n, _ = transcribe_one(model, a.model, device, job["media"], job["out"], job.get("language"), not job.get("noFillers", False))
            print(f"done {job['out']} {n}", flush=True)
        except BaseException as e:  # keep serving the next job
            print(f"error {job.get('out')} {str(e)[:300]}".replace("\n", " "), flush=True)


if __name__ == "__main__":
    main()
