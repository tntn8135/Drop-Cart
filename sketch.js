// ===============================
// Matter.js
// ===============================
let Engine = Matter.Engine,
    World = Matter.World,
    Bodies = Matter.Bodies,
    Common = Matter.Common;

let engine, world;
let items = [];
let cartBase, cartWalls = [];
let lastDropTime = 0;
let dropCooldown = 1000;

// poly-decomp 등록 (J 알파벳)
Common.setDecomp(window.decomp);


// 이미지
let imgA, imgD, imgO, imgJ;
let imgJRatio = 1;
let imgReceipt, imgCart;


// 폰트

let gameFont;


// PoseNet
let video;
let poseNet;
let poses = [];
let currentLabel = "none";

// 게임 상태
let gameState = "ready"; // ready, playing
let isGameOver = false;  
let receiptY;
let targetReceiptY;
let receiptSpeed = 0.1;

// Amazon / FakeStore 상품
let amazonItem = null;

// 결과 화면 단계
let resultStage = 0; 
// 0 = 기본 영수증 + 화살표
// 1 = 확장 영수증 + 다른 상품 + Restart

let extraAmazonItems = [];

// 버튼
let arrowBtn = { x: 0, y: 0, r: 26 };
let restartBtn = { x: 0, y: 0, w: 220, h: 70 };

// 확장 영수증 목표 위치
let expandedReceiptY;


// helper
function getMostFrequentLetter(counts) {
  let maxCount = Math.max(...Object.values(counts));
  let lettersWithMax = Object.keys(counts).filter(l => counts[l] === maxCount);
  return lettersWithMax[Math.floor(Math.random() * lettersWithMax.length)];
}

// 샘플 상품 (알파벳 기준)
function getSampleAmazonItem(letter) {
  const sampleProducts = {
    A: [
      {title: "Apple AirPods", price: "$99", stars: "4.5"},
      {title: "Awesome Apron", price: "$25", stars: "4.0"}
    ],
    D: [
      {title: "Desk Lamp", price: "$49", stars: "4.2"},
      {title: "Dog Toy", price: "$15", stars: "4.3"}
    ],
    J: [
      {title: "Jacket", price: "$59", stars: "4.1"},
      {title: "Juicer", price: "$35", stars: "4.4"}
    ],
    O: [
      {title: "Organizer Box", price: "$20", stars: "4.0"},
      {title: "Oven Mitts", price: "$12", stars: "4.2"}
    ]
  };
  const list = sampleProducts[letter] || [{title: `${letter} Sample Product`, price: "$10", stars: "4.0"}];
  return list[Math.floor(Math.random() * list.length)];
}

// fakestore API 사용
async function getAmazonItem(queryLetter) {
  try {
    const response = await fetch("https://fakestoreapi.com/products");
    const data = await response.json();

    const filtered = data.filter(
      p => p.title[0].toUpperCase() === queryLetter
    );

    if (filtered.length > 0) {
      const item = filtered[Math.floor(Math.random() * filtered.length)];

      return {
        title: item.title,
        price: `$${item.price}`,
        stars: item.rating
          ? `${item.rating.rate} ★ (${item.rating.count})`
          : "N/A"
      };
    } else {
      return getSampleAmazonItem(queryLetter);
    }
  } catch (e) {
    console.error(e);
    return getSampleAmazonItem(queryLetter);
  }
}

// preload
function preload() {
  imgA = loadImage('assets/A.png');
  imgD = loadImage('assets/D.png');
  imgO = loadImage('assets/O.png');
  imgJ = loadImage('assets/J.png', img => { imgJRatio = img.width / img.height; });
  imgReceipt = loadImage('assets/receipt.png');
  imgCart = loadImage('assets/cart.png');

  gameFont = loadFont('assets/DNFBitBitv2.ttf');
}

// setup
function setup() {
  const canvas = createCanvas(1920, 1080);

  engine = Engine.create();
  world = engine.world;
  engine.gravity.y = 1;


// 카트 기준
const CART_FLOOR_Y = height => height - 115;

  // 카트 바디
  let cartWidth = width * 0.64;
  let cartFloorY = CART_FLOOR_Y(height);

  cartBase = Bodies.rectangle(
    width / 2,
    cartFloorY - 15,
    cartWidth,
    30,
    { isStatic: true }
  );
  World.add(world, cartBase);

  // 벽
  let wallHeight = height / 6;
  let wallThickness = 20;

  let bottomY = cartFloorY - wallHeight / 2;
  let leftX  = width/2 - cartWidth/2 + wallThickness/2 + 20;
  let rightX = width/2 + cartWidth/2 - wallThickness/2 - 20;

  let wallVerts = [
    { x:-wallThickness/2, y:-wallHeight/2 },
    { x: wallThickness/2, y:-wallHeight/2 },
    { x: wallThickness/2 + 20, y: wallHeight/2 },
    { x:-wallThickness/2 + 20, y: wallHeight/2 }
  ];

  let leftWall = Bodies.fromVertices(leftX, bottomY, wallVerts, { isStatic:true });
  let rightWall = Bodies.fromVertices(
    rightX,
    bottomY,
    wallVerts.map(v => ({ x:-v.x, y:v.y })),
    { isStatic:true }
  );

  cartWalls.push(leftWall, rightWall);
  World.add(world, [leftWall, rightWall]);


  // 카메라
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  // 검색창 가운데 배치
  const input = document.getElementById('startInput');
  input.style.position = 'absolute';
  input.style.top = '50%';
  input.style.left = '50%';
  input.style.transform = 'translate(-50%, -50%)';
  input.style.fontSize = '48px';
  input.style.textAlign = 'center';
  input.style.padding = '15px';
  input.style.zIndex = '1000';
  input.style.color = '#F38983'; // start 텍스트 색상

  input.addEventListener('keydown', async (e) => {
    if(e.key === "Enter" && input.value.toLowerCase() === "start") {
      gameState = "playing";
      input.style.display = "none";
      initPoseNet();
    }
  });
}

// PoseNet
function initPoseNet() {
  poseNet = ml5.poseNet(video, () => console.log("PoseNet Ready!"));
  poseNet.on("pose", function(results){
    poses = results;
    detectPoseLabel();
  });
}

function detectPoseLabel() {
  if (poses.length > 0 && gameState === "playing" && !isGameOver) {
    let pose = poses[0].pose;
    let rightY = pose.rightWrist.y;
    let leftY = pose.leftWrist.y;
    let noseY = pose.nose.y;

    if (rightY < noseY && leftY < noseY) currentLabel = "A";
    else if (rightY > noseY && leftY > noseY) currentLabel = "D";
    else if (rightY < noseY && leftY > noseY) currentLabel = "O";
    else if (rightY > noseY && leftY < noseY) currentLabel = "J";
    else currentLabel = "none";

    if (currentLabel !== "none") tryDropItem(currentLabel);
  }
}

// 아이템 생성
function tryDropItem(label) {
  if (millis() - lastDropTime < dropCooldown || isGameOver) return;
  createItem(label);
  lastDropTime = millis();
}

function createItem(letter) {
  let x = width / 2;
  let y = -50;
  let size = random(180, 240);
  let body;

  if (letter === "A") {
    let h = size, w = size * 0.9;
    body = Bodies.fromVertices(x, y, [
      { x:  0,    y: -h/2 },
      { x:  w/2,  y:  h/2 },
      { x: -w/2,  y:  h/2 }
    ]);
    body.w = w; body.h = h;
  } else if (letter === "D") {
    let w = size * 0.66, h = size;
    body = Bodies.rectangle(x, y, w, h);
    body.w = w; body.h = h;
  } else if (letter === "O") {
    body = Bodies.circle(x, y, size/2);
    body.r = size/2; body.w = size; body.h = size;
  } else if (letter === "J") {
    let w = size * 0.75, h = size;
    body = Bodies.fromVertices(x, y, [
      { x:-w*0.18, y:-h/2 },
      { x: w*0.18, y:-h/2 },
      { x: w*0.18, y: h*0.10 },
      { x: w*0.45, y: h*0.15 },
      { x: w*0.55, y: h*0.40 },
      { x: w*0.50, y: h*0.85 },
      { x: w*0.15, y: h*0.45 },
      { x:-w*0.40, y: h*0.70 },
      { x:-w*0.18, y: h*0.10 }
    ], { friction: 0.7, restitution: 0.05 });
    body.w = w; body.h = h;
  }

  body.label = letter;
  World.add(world, body);
  items.push(body);
}

function draw() {
  background(255,161,160);

  if (!isGameOver) Engine.update(engine);

  // 아이템 렌더링
  for (let obj of items) {
    push();
    translate(obj.position.x, obj.position.y);
    rotate(obj.angle);
    imageMode(CENTER);

    if (obj.label === "A") image(imgA, 0, -obj.h*0.12, obj.w, obj.h);
    if (obj.label === "D") image(imgD, 0, 0, obj.w, obj.h);
    if (obj.label === "O") image(imgO, 0, 0, obj.w, obj.h);
    if (obj.label === "J") {
      let drawH = obj.h * 1.15;
      let drawW = drawH * imgJRatio;
      image(imgJ, 0, obj.h*0.08, drawW, drawH);
    }
    pop();

    // 게임오버 체크
    if(obj.position.y - obj.h/2 > height && !isGameOver){
      isGameOver = true;
      receiptY = height + imgReceipt.height;
      targetReceiptY = height - imgReceipt.height * 0.15;

      // 알파벳 개수
      let counts = {A:0, D:0, J:0, O:0};
      for (let o of items) if(counts[o.label] !== undefined) counts[o.label]++;

      // 가장 많이 나온 알파벳 중 랜덤 선택 후 상품 가져오기
      const maxCount = Math.max(...Object.values(counts));
      const lettersWithMax = Object.keys(counts).filter(l => counts[l] === maxCount);
      const randomLetter = lettersWithMax[Math.floor(Math.random() * lettersWithMax.length)];

      getAmazonItem(randomLetter).then(item => amazonItem = item);
      extraAmazonItems = [];

      ["A","D","J","O"].forEach(letter => {
        if (letter !== randomLetter && counts[letter] > 0) {
          getAmazonItem(letter).then(item => {
            extraAmazonItems.push({
              letter,
              title: item.title
            });
          });
        }
      });
    }
  }

  // 카트
  imageMode(CORNER);
  image(imgCart, 0, 0, width, height);

  // 게임오버 화면
  if(isGameOver){

    let isArrowHover = false;
    let isRestartHover = false;

    receiptY += (targetReceiptY - receiptY) * receiptSpeed;
    imageMode(CENTER);
    image(imgReceipt, width/2, receiptY);

    let counts = {A:0, D:0, J:0, O:0};
    for (let obj of items) if(counts[obj.label] !== undefined) counts[obj.label]++;
    let total = counts.A + counts.D + counts.J + counts.O;

    textFont(gameFont);
    textAlign(CENTER, CENTER);
    noStroke();

    let baseY = receiptY - imgReceipt.height * 0.33;
    let numberGap = 115;
    let lineGap = 85;
    textSize(28);

    fill(84,147,169); text(counts.D, width/2 - numberGap*1.5, baseY);
    fill(247,122,105); text(counts.A, width/2 - numberGap*0.5, baseY);
    fill(244,195,91); text(counts.J, width/2 + numberGap*0.5, baseY);
    fill(233,135,67); text(counts.O, width/2 + numberGap*1.5, baseY);

    textSize(46);
    fill(243,137,131);
    text(`TOTAL: ${total}`, width/2, baseY + lineGap);

    // -------------------------------
    // 줄바꿈 처리 함수
    // -------------------------------
    function drawWrappedText(txt, x, y, maxWidth, lineHeight) {
      let paragraphs = txt.split('\n');
      let offsetY = 0;

      for (let p of paragraphs) {
        let words = p.split(' ');
        let line = '';

        for (let i = 0; i < words.length; i++) {
          let testLine = line + words[i] + ' ';
          if (textWidth(testLine) > maxWidth && line !== '') {
            text(line, x, y + offsetY);
            line = words[i] + ' ';
            offsetY += lineHeight;
          } else {
            line = testLine;
          }
        }

        if (line !== '') {
          text(line, x, y + offsetY);
          offsetY += lineHeight;
        }

        offsetY += lineHeight * 0.6;
      }
    }

    // -------------------------------
    // 상품명 + 가격 + 평점 + 설명
    // -------------------------------
    if(amazonItem){
      let receiptWidthInner = imgReceipt.width * 0.8;

      // 작품 설명 먼저 출력 (상품명 위)
      textSize(18);
      fill(160);
      textAlign(CENTER, TOP);
      let descriptionText =
      "우리는 물건을 계속 카트에 담고있지만\n실제로 어떤 상품을 담고있는지는 본인조차 모릅니다.";
      let descriptionY = baseY + lineGap + 92;
      drawWrappedText(descriptionText, width / 2, descriptionY, receiptWidthInner, 15);

      let descriptionText2 =
      "카트에 가장 많이 들어있던 알파벳을 통해\n당신이 담고있던 아이템의 이름을 알려드립니다.";
      let descriptionY2 = descriptionY+58
      drawWrappedText(descriptionText2, width / 2, descriptionY2, receiptWidthInner, 15);

      // 상품명 출력 (설명 아래)
      let amazonBaseY = descriptionY + 150;
      textSize(32);
      fill(243,137,131);
      drawWrappedText(amazonItem.title, width/2, amazonBaseY, receiptWidthInner, 38);

      // 가격/평점
      let lineGap2 = 170;
      textSize(28);
      drawWrappedText(`Price: ${amazonItem.price}`, width/2, amazonBaseY + lineGap2, receiptWidthInner, 32);
      drawWrappedText(`Rating: ${amazonItem.stars}`, width/2, amazonBaseY + lineGap2 + 50, receiptWidthInner, 32);
    }

    // 결과 화면 버튼 & 확장 연출
    if (resultStage === 0) targetReceiptY = height - imgReceipt.height * 0.15;
    else targetReceiptY = height - imgReceipt.height * 0.45;

    // 화살표 버튼
    if (resultStage === 0) {
      arrowBtn.x = width / 2;
      arrowBtn.y = height - 90;
      isArrowHover = dist(mouseX, mouseY, arrowBtn.x, arrowBtn.y) < arrowBtn.r;
      cursor(isArrowHover ? HAND : ARROW);

      noStroke();
      fill(isArrowHover ? 245 : 255);
      circle(arrowBtn.x, arrowBtn.y, arrowBtn.r * 2);

      fill(243,137,131);
      triangle(
        arrowBtn.x - 8, arrowBtn.y - 6,
        arrowBtn.x + 8, arrowBtn.y - 6,
        arrowBtn.x, arrowBtn.y + 10
      );
    }

    // 확장 화면
    if (resultStage === 1) {
      textFont(gameFont);
      textAlign(CENTER, TOP);

      let infoY = receiptY + imgReceipt.height * 0.18;

      // 다른 상품들
      fill(243,137,131);
      textSize(24);
      text("Other Picks", width / 2, infoY-50);

      textSize(22);
      infoY += 50; // 기존보다 간격 증가
      for (let item of extraAmazonItems) {
        drawWrappedText(`${item.letter} : ${item.title}`, width / 2, infoY, imgReceipt.width*0.75, 28);
        infoY += 60; // 줄 간격 넓힘
      }

      // Restart 버튼
      restartBtn.x = width - 160;
      restartBtn.y = height - 80;

      noStroke();
      fill(255,253,239);
      rectMode(CENTER);
      rect(restartBtn.x, restartBtn.y, restartBtn.w, restartBtn.h, 30);

      // 버튼 텍스트 완전히 가운데 정렬
      fill(243,137,131);
      textSize(32);
      textAlign(CENTER, CENTER);
      text("Restart", restartBtn.x, restartBtn.y-5);
    }
  }

  // 게임 중 안내 텍스트
  if (gameState === "playing" && !isGameOver) {
    textFont(gameFont);
    textAlign(CENTER, TOP);
    noStroke();

    fill(255, 240);
    rectMode(CENTER);
    rect(width / 2, 70, 760, 70, 20);

    fill(243, 137, 131);
    textSize(36);
    text("A, D, J, O 포즈를 취해보세요", width / 2, 48);

    textSize(22);
    stroke(255); strokeWeight(4);
    fill(120);
    textAlign(CENTER, CENTER);
    text(`현재 포즈: ${currentLabel}`, width / 2, 120);
    noStroke();
  }

  // if(!isGameOver && gameState==='playing'){
  //   fill(0);
  //   textFont(gameFont);
  //   textSize(32);
  //   textAlign(LEFT);
  //   text("POSE: " + currentLabel, 20, 40);
  // }
}


function mousePressed() {

    console.log("mousePressed");
    
  if (!isGameOver) return;

  // 화살표 클릭
  if (resultStage === 0) {
    if (dist(mouseX, mouseY, arrowBtn.x, arrowBtn.y) < arrowBtn.r) {
      resultStage = 1;
    }
  }

  // Restart 버튼
  else if (resultStage === 1) {
    if (
      mouseX > restartBtn.x - restartBtn.w/2 &&
      mouseX < restartBtn.x + restartBtn.w/2 &&
      mouseY > restartBtn.y - restartBtn.h/2 &&
      mouseY < restartBtn.y + restartBtn.h/2
    ) {
      window.location.reload();
    }
  }
}
