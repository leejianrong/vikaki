#!/usr/bin/env bash
# Downloads the spike inputs. Clips are not committed because the ElevenLabs demo audio has no clear redistribution terms.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p clips
B=https://raw.githubusercontent.com/wass08/wawa-lipsync/main/examples/lipsync-demo/public/audios
for n in Emma_a Emma_e Emma_o Emma_vowels Emma_you Emma_consonants Liam_a Liam_e Liam_o Liam_vowels Text_to_Speech_audio; do
  curl -sfL -o "clips/ElevenLabs_$n.mp3" "$B/ElevenLabs_$n.mp3"
done
curl -sfL -o clips/welcome-message.mp3 "$B/welcome-message.mp3"
curl -sfL -o profile.json https://raw.githubusercontent.com/mrxz/wlipsync/main/example/profile.json
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=44100:cl=mono -t 2 clips/silence.wav
ffmpeg -loglevel error -y -f lavfi -i "anoisesrc=d=2:c=pink:r=44100:a=0.02" clips/room-noise.wav
echo "ready: npm install && node serve.mjs & node run.mjs"
