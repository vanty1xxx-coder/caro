"""Render licensed full-song club remixes, preserving the original melodic arrangement."""
import json, math, subprocess, pathlib
import numpy as np
import scipy.signal as sig
import soundfile as sf
import librosa

SR = 44100
def filt(x, hz, kind, order=3):
    return sig.sosfilt(sig.butter(order, hz, kind, fs=SR, output='sos'), x, axis=0)
def add(dst, sample, start, level=1):
    i = int(start*SR)
    if i < 0 or i >= len(dst): return
    n = min(len(sample), len(dst)-i)
    dst[i:i+n] += sample[:n,None]*level
def render(item):
    idx=item['index']; rng=np.random.default_rng(4300+idx)
    source=f'/tmp/vina-{idx}.mp3'; wav=f'/tmp/vina-{idx}.wav'
    bpm=140+idx%2*2; beat=60/bpm
    subprocess.run(['ffmpeg','-y','-v','error','-i',source,'-af',f'atempo={bpm/item["bpm"]}', '-ar',str(SR),'-ac','2',wav],check=True)
    music,_=sf.read(wav,dtype='float32',always_2d=True)
    mono=librosa.resample(music.mean(axis=1),orig_sr=SR,target_sr=22050)
    # Locate a real downbeat instead of placing a second beat grid at an arbitrary offset.
    _, frames=librosa.beat.beat_track(y=mono,sr=22050,start_bpm=bpm,tightness=200)
    times=librosa.frames_to_time(frames,sr=22050)
    offset=float(times[0]) if len(times) and times[0]<3 else 0
    chroma=librosa.feature.chroma_stft(y=mono,sr=22050,n_fft=4096,hop_length=1024)
    duration=len(music)/SR; total_bars=int((duration-offset)/(4*beat))
    t=np.arange(len(music))/SR
    # Replace sub-bass, retain the complete recorded lead, harmonies and melodic development.
    music=filt(music,135,'highpass')*.85
    drums=np.zeros_like(music); bass=np.zeros_like(music)
    kt=np.arange(int(.34*SR))/SR
    freq=49+(125-idx*3)*np.exp(-kt/.022)
    kick=np.sin(2*np.pi*np.cumsum(freq)/SR)*np.exp(-kt/0.085)
    kick+=rng.normal(0,1,len(kt))*np.exp(-kt/.002)*.1
    kick=np.tanh(kick*1.3)*.38
    ht=np.arange(int(.105*SR))/SR
    hat=filt(rng.normal(0,1,len(ht)),7000,'highpass')*np.exp(-ht/.018)*.027
    ct=np.arange(int(.19*SR))/SR
    clap=filt(rng.normal(0,1,len(ct)),[1200,8000],'bandpass')
    clap*=sum(np.where(ct>=q,np.exp(-np.maximum(ct-q,0)/.025),0) for q in [0,.011,.024])*.037
    sidechain=np.ones(len(music),dtype='float32')
    for bar in range(max(0,total_bars)):
        start=offset+bar*4*beat
        intro=bar<8; outro=bar>=total_bars-8
        cycle=bar%64; breakdown=40<=cycle<48; build=48<=cycle<56
        level=.35 if intro or outro else .6 if build else 1
        if breakdown: level=.0
        for b in range(4):
            at=start+b*beat
            if not breakdown:
                add(drums,kick,at,level)
                i=int(at*SR); n=min(int(beat*SR),len(music)-i)
                if n>0: sidechain[i:i+n]=1-.35*level*np.exp(-np.arange(n)/SR/.075)
            if b in [1,3] and not intro: add(drums,clap,at,level)
            add(drums,hat,at+beat*.5,max(level,.25))
            if build:
                add(drums,clap,at+beat*.5,level*.3)
        if breakdown or intro or outro: continue
        # Follow the source harmony once per two bars; do not impose one fixed bass note.
        section=(bar//2)*2
        lo=int((offset+section*4*beat)*22050/1024)
        hi=max(lo+1,int((offset+(section+2)*4*beat)*22050/1024))
        c=chroma[:,lo:hi].mean(axis=1) if lo<chroma.shape[1] else chroma.mean(axis=1)
        scores=np.array([c[r]+.7*max(c[(r+3)%12],c[(r+4)%12])+.55*c[(r+7)%12] for r in range(12)])
        root=int(np.argmax(scores))
        for b in range(4):
            note=36+root+(7 if b==3 and (bar+idx)%4==3 else 0)
            if note>47: note-=12
            f=440*2**((note-69)/12)
            nt=np.arange(int(beat*.43*SR))/SR
            tone=np.sin(2*np.pi*f*nt)+.24*np.sin(4*np.pi*f*nt)+.08*np.sin(6*np.pi*f*nt)
            env=(1-np.exp(-nt/.003))*np.exp(-nt/.075)*np.minimum(1,(nt[-1]-nt)/.015)
            add(bass,np.tanh(tone*1.2)*env*.18,start+(b+.5)*beat,level)
    # The full source supplies distinct introductions, themes and breaks; preserve its natural end.
    mix=music*sidechain[:,None]+drums+bass
    fade=np.minimum(1,t/2)*np.minimum(1,np.maximum(duration-t,0)/5)
    mix*=fade[:,None]
    peak=float(np.max(np.abs(mix)))
    if peak>0: mix*=.89/peak
    out=pathlib.Path(item['path']);out.parent.mkdir(parents=True,exist_ok=True)
    mixed=f'/tmp/vina-mix-{idx}.wav';sf.write(mixed,mix,SR,subtype='PCM_24')
    subprocess.run(['ffmpeg','-y','-v','error','-i',mixed,'-af','loudnorm=I=-16:TP=-1.2:LRA=11','-c:a','libmp3lame','-b:a','192k',str(out)],check=True)
    print(json.dumps({'title':item['title'],'bpm':bpm,'duration':duration,'source_bpm':item['bpm'],'arrangement':'full recorded melody, new club drums, offbeat harmonic bass, breaks, sidechain and master'}),flush=True)

if __name__=='__main__':
    import os
    for item in json.loads(os.environ['SOURCES'])['remixes']: render(item)