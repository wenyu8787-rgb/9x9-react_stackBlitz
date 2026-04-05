import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  onSnapshot 
} from 'firebase/firestore';
import { Trophy, Timer, User, Play, XCircle } from 'lucide-react';

// --- Firebase 初始化 ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'multiplication-whack-react';

// --- 音效工具 ---
const playTone = (freq, duration, type = 'sine', volume = 0.1) => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
};

const sounds = {
  start: () => { playTone(440, 0.3, 'square'); setTimeout(() => playTone(880, 0.3, 'square'), 100); },
  correct: () => playTone(1200, 0.2, 'sine', 0.15),
  wrong: () => playTone(150, 0.3, 'sawtooth', 0.2),
  end: () => { [330, 261, 196].forEach((f, i) => setTimeout(() => playTone(f, 0.5, 'sine'), i * 150)); }
};

export default function App() {
  // --- 狀態定義 ---
  const [user, setUser] = useState(null);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [gameActive, setGameActive] = useState(false);
  const [activeMole, setActiveMole] = useState(null); // 當前浮現的地鼠索引 (0-5)
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [leaderboard, setLeaderboard] = useState([]);
  const [flash, setFlash] = useState(null); // 'correct' | 'wrong'
  const [showModal, setShowModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const moleTimeoutRef = useRef(null);
  const gameIntervalRef = useRef(null);

  // --- Firebase 認證與數據監聽 ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    // 監聽排行榜數據 (遵循 Rule 2: 簡單查詢，JS 排序)
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data());
      const sortedData = data.sort((a, b) => b.score - a.score).slice(0, 10);
      setLeaderboard(sortedData);
    }, (error) => console.error("Leaderboard Error:", error));

    return () => unsubscribe();
  }, [user]);

  // --- 遊戲邏輯 ---
  const generateQuestion = useCallback(() => {
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    const answer = a * b;
    let distractors = new Set();
    while (distractors.size < 2) {
      const diff = (Math.floor(Math.random() * 6) + 1) * (Math.random() > 0.5 ? 1 : -1);
      const wrong = answer + diff;
      if (wrong > 0 && wrong !== answer) distractors.add(wrong);
    }
    const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
    return { text: `${a}×${b}`, answer, options };
  }, []);

  const spawnMole = useCallback(() => {
    if (!gameActive) return;

    const newIdx = Math.floor(Math.random() * 6);
    const question = generateQuestion();
    
    setActiveMole(newIdx);
    setCurrentQuestion(question);

    const duration = Math.random() * 1000 + 1500;
    moleTimeoutRef.current = setTimeout(() => {
      setActiveMole(null);
      // 短暫間隔後再產生下一個
      moleTimeoutRef.current = setTimeout(spawnMole, 300);
    }, duration);
  }, [gameActive, generateQuestion]);

  const startGame = () => {
    const finalName = playerName.trim() || "無名英雄";
    setPlayerName(finalName);
    setScore(0);
    setTimeLeft(30);
    setGameActive(true);
    setShowModal(false);
    sounds.start();
  };

  useEffect(() => {
    if (gameActive) {
      spawnMole();
      gameIntervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            endGame();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      clearInterval(gameIntervalRef.current);
      clearTimeout(moleTimeoutRef.current);
    };
  }, [gameActive]);

  const endGame = async () => {
    setGameActive(false);
    setActiveMole(null);
    sounds.end();
    setShowModal(true);
  };

  useEffect(() => {
    if (showModal && user) {
        saveScore();
    }
  }, [showModal, user]);

  const saveScore = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'leaderboard'), {
        name: playerName,
        score: score,
        uid: user.uid,
        timestamp: Date.now()
      });
    } catch (e) {
      console.error("Save score error:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const checkAnswer = (val) => {
    if (!gameActive || !currentQuestion) return;

    if (val === currentQuestion.answer) {
      setScore(s => s + 10);
      sounds.correct();
      setFlash('correct');
      setActiveMole(null);
      clearTimeout(moleTimeoutRef.current);
      setTimeout(spawnMole, 200);
    } else {
      setScore(s => Math.max(0, s - 5));
      sounds.wrong();
      setFlash('wrong');
    }
    setTimeout(() => setFlash(null), 400);
  };

  // --- UI 元件 ---
  return (
    <div className="min-h-screen w-full bg-green-500 bg-[radial-gradient(#22c55e_1px,transparent_1px)] [background-size:20px_20px] flex flex-col items-center p-4 pt-8">
      
      {/* 頂部資訊欄 */}
      <div className="w-full max-w-2xl bg-white/90 backdrop-blur-md rounded-3xl p-6 shadow-2xl mb-8 flex justify-between items-center border-b-8 border-green-600">
        <div className="text-center">
          <p className="text-gray-500 text-xs font-bold flex items-center gap-1 justify-center"><Trophy size={14}/> SCORE</p>
          <p className="text-4xl font-black text-green-700">{score}</p>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-black text-amber-900">九九乘法大挑戰</h1>
          <div className="mt-1 px-4 py-1 bg-amber-600 text-white rounded-full text-xs font-bold">
            {gameActive ? "地鼠出沒中！" : "準備好了嗎？"}
          </div>
        </div>
        <div className="text-center">
          <p className="text-gray-500 text-xs font-bold flex items-center gap-1 justify-center"><Timer size={14}/> TIME</p>
          <p className={`text-4xl font-black ${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-amber-600'}`}>{timeLeft}s</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 w-full max-w-6xl items-start justify-center">
        
        {/* 排行榜 */}
        <div className="w-full lg:w-72 bg-white/80 rounded-[2rem] p-6 shadow-xl border-t-4 border-amber-500">
          <h3 className="text-xl font-black text-amber-800 mb-4 flex items-center justify-center gap-2">
            🏆 全球英雄榜
          </h3>
          <div className="space-y-2 max-h-60 lg:max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {leaderboard.length > 0 ? leaderboard.map((item, i) => (
              <div key={i} className={`flex items-center justify-between p-3 rounded-2xl ${i === 0 ? 'bg-yellow-100 border border-yellow-400' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-3">
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-black ${i < 3 ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-600'}`}>
                    {i + 1}
                  </span>
                  <span className="font-bold text-amber-900 truncate w-24 text-sm">{item.name}</span>
                </div>
                <span className="font-black text-amber-600">{item.score}</span>
              </div>
            )) : (
              <p className="text-center text-gray-400 py-8 italic text-sm">載入中...</p>
            )}
          </div>
        </div>

        {/* 遊戲主體 */}
        <div className="flex-1 flex flex-col items-center w-full max-w-xl">
          <div className={`relative p-6 bg-amber-800/20 rounded-[3rem] border-8 transition-colors duration-300 ${
            flash === 'correct' ? 'border-green-500' : flash === 'wrong' ? 'border-red-500' : 'border-amber-900/20'
          }`}>
            <div className="grid grid-cols-3 gap-4 md:gap-8">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="relative aspect-square w-24 md:w-32 bg-amber-950 rounded-full shadow-[inset_0_8px_15px_rgba(0,0,0,0.7)] overflow-hidden border-2 border-amber-900">
                  <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-b from-amber-400 to-amber-600 rounded-full border-4 border-amber-300 shadow-xl transition-transform duration-300 ${activeMole === i ? 'translate-y-0' : 'translate-y-[105%]'}`}>
                    <span className="text-xl md:text-2xl font-black text-white drop-shadow-md">
                      {activeMole === i ? currentQuestion?.text : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 答案按鈕 */}
          <div className="mt-10 grid grid-cols-3 gap-4 w-full">
            {currentQuestion ? currentQuestion.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => checkAnswer(opt)}
                disabled={!gameActive}
                className={`py-4 md:py-6 rounded-2xl text-2xl md:text-3xl font-black text-white shadow-[0_6px_0_rgba(0,0,0,0.3)] active:translate-y-1 active:shadow-none transition-all transform hover:scale-105 ${
                  i === 0 ? 'bg-blue-500' : i === 1 ? 'bg-purple-500' : 'bg-pink-500'
                } ${!gameActive && 'opacity-50 grayscale'}`}
              >
                {opt}
              </button>
            )) : [0, 1, 2].map(i => (
              <button key={i} disabled className="py-4 md:py-6 rounded-2xl text-2xl md:text-3xl font-black text-white bg-gray-400 opacity-50 cursor-not-allowed">?</button>
            ))}
          </div>

          {/* 控制區 */}
          {!gameActive && !showModal && (
            <div className="mt-8 flex flex-col items-center gap-4 w-full">
              <div className="relative w-full max-w-xs">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-600" size={20}/>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="輸入你的大名..."
                  className="w-full pl-12 pr-6 py-4 rounded-full border-4 border-amber-500 text-lg font-bold outline-none text-center focus:ring-4 ring-amber-300"
                />
              </div>
              <button 
                onClick={startGame}
                className="bg-orange-500 hover:bg-orange-600 text-white font-black px-16 py-4 rounded-full text-2xl shadow-[0_10px_0_#c2410c] active:translate-y-1 active:shadow-none transition-all transform hover:scale-110 flex items-center gap-2"
              >
                <Play fill="currentColor"/> 開始挑戰
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 結算視窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[3rem] p-10 max-w-sm w-full text-center border-8 border-amber-500 shadow-2xl relative">
            <button onClick={() => setShowModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><XCircle/></button>
            <h2 className="text-4xl font-black text-amber-600 mb-2">時間終了！</h2>
            <p className="text-xs text-amber-700 font-bold mb-6">
              {isSaving ? "正在雲端存檔..." : "分數已成功同步"}
            </p>
            <div className="mb-8">
              <p className="text-gray-400 font-bold uppercase tracking-widest text-sm">FINAL SCORE</p>
              <p className="text-8xl font-black text-green-600 leading-tight">{score}</p>
            </div>
            <button 
              onClick={() => { setShowModal(false); startGame(); }}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-black py-4 rounded-full text-xl shadow-[0_8px_0_#16a34a] active:translate-y-1 active:shadow-none transition-all"
            >
              再戰一回
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #b45309; border-radius: 10px; }
      `}} />
    </div>
  );
}