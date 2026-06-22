import React, { useMemo, useRef, useState, useEffect } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { QuizGenerator, QuizQuestion, hashQuestionText } from './QuizGenerator';

export const QuizModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { nodes, selectedNodeId, edges, setQuizActive, incrementQuizScore, quizScore, questionHistory, addQuestionHistory } = useGraphStore();
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const currentQuestionHashRef = useRef<string | null>(null);

  useEffect(() => {
    const generator = new QuizGenerator();
    const nextQuestion = generator.generateQuiz(nodes as any, edges as any, selectedNodeId, questionHistory);
    setQuestion(nextQuestion);
    setSelectedOptionId(null);
    setIsAnswered(false);
    setIsCorrect(false);
    currentQuestionHashRef.current = nextQuestion ? hashQuestionText(nextQuestion.questionText) : null;
  }, [nodes, edges, selectedNodeId, questionHistory]);

  const recordQuestionHistory = () => {
    const questionHash = currentQuestionHashRef.current;
    if (!questionHash) return;
    addQuestionHistory(questionHash);
  };

  useEffect(() => {
    if (!question) return;
    if (isAnswered) {
      useGraphStore.getState().setBlastHighlight(question.focusNodeIds, question.focusEdgeIds);
    }
  }, [question, isAnswered]);

  const options = useMemo(() => question?.options ?? [], [question]);

  const handleAnswer = (id: string) => {
    if (!question || isAnswered) return;
    setSelectedOptionId(id);
    const correct = question.correctAnswerIds.includes(id);
    setIsCorrect(correct);
    setIsAnswered(true);
    incrementQuizScore(correct);

    useGraphStore.getState().setBlastHighlight(question.focusNodeIds, question.focusEdgeIds);

    window.setTimeout(() => {
      useGraphStore.getState().clearBlastHighlight();
    }, 3000);
  };

  const handleClose = () => {
    recordQuestionHistory();
    useGraphStore.getState().clearBlastHighlight();
    setQuizActive(false);
    onClose();
  };

  if (!question) {
    return (
      <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-[520px] bg-[var(--vscode-editor-background)] border border-white/10 rounded-2xl p-6 text-white">
          Loading quiz...
          <div className="mt-4 text-sm text-gray-300">Select a node first.</div>
          <button onClick={handleClose} className="mt-4 px-3 py-2 rounded-lg border border-white/10 bg-white/5">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[560px] bg-[var(--vscode-editor-background)] border border-white/10 rounded-2xl p-6 text-white shadow-2xl">
        <div className="flex justify-between items-start mb-4">
          <div className="text-white">
            <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Mental Model Quiz</div>
            <div className="text-lg font-bold">{question.questionText}</div>
            <div className="mt-2 text-xs text-gray-400">
              Score: {quizScore.correct} correct, {quizScore.incorrect} incorrect
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-300 hover:text-white px-2 py-1 rounded"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2">
          {options.map(opt => {
            const selected = selectedOptionId === opt.id;
            const correctOption = question.correctAnswerIds.includes(opt.id);

            let border = 'border-white/10';
            let bg = 'bg-white/5';
            let text = 'text-white';

            if (isAnswered) {
              if (correctOption) {
                border = 'border-green-400/50';
                bg = 'bg-green-500/10';
                text = 'text-green-200';
              } else if (selected && !correctOption) {
                border = 'border-red-400/50';
                bg = 'bg-red-500/10';
                text = 'text-red-200';
              }
            }

            return (
              <button
                key={opt.id}
                disabled={isAnswered}
                onClick={() => handleAnswer(opt.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border ${border} ${bg} ${text} transition-colors`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {isAnswered && (
          <div className={`mt-4 text-sm ${isCorrect ? 'text-green-200' : 'text-red-200'}`}>
            {isCorrect ? '✅ Correct. Relevant nodes are highlighted.' : '❌ Not quite. The correct path is highlighted above.'}
            <div className="mt-2 text-gray-300">
              {question.explanation}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
