# 부검 사진 장기 인식 모델 학습

1. 반석 시스템 → **사진 태깅** → '학습 데이터 받기'로 zip을 받는다. 태깅 '완료'한 사진만 들어간다.
2. GPU가 있는 PC나 무료 Google Colab(런타임 → GPU)에서:
   ```
   pip install torch torchvision onnx pillow numpy
   python train_organs.py bansuk-necropsy-labels-YYYYMMDD.zip --epochs 30 --out out/
   ```
   - 태깅된 영역이 20개보다 적은 장기는 자동으로 뺀다 (`--min-regions`).
   - 끝에 장기별 검증 결과가 나온다. `찾음`은 검증 사진에서 수의사가 그린 영역과 절반 이상 겹치게 찾은 비율이다.
3. `out/organs.onnx`, `out/organs.json` 을 서버 `backend/data/models/` 에 넣고 `./start.sh`.
4. 사진 태깅 화면에서 '태깅 안 한 사진 자동 표시'를 누르면 남은 사진에 제안이 붙는다. 수의사는 맞으면 확인, 틀리면 고친다.
5. 고친 사진이 쌓이면 1~4를 다시 한다 (버전은 날짜로 붙는다).

서버는 CPU로 사진 한 장에 1~2초 정도 걸린다 (onnxruntime). GPU 서버가 필요 없다.

참고 목표: 장기마다 확인된 영역 100~150개 이상이면 쓸 만한 제안이 나오기 시작한다.
처음 학습 전에는 서버에서 학습 스크립트를 시험해 보지 못했다 (이 저장소 개발 환경에서 PyTorch를 받을 수 없음).
첫 학습 때 오류가 나면 메시지를 그대로 알려 주면 고친다.
