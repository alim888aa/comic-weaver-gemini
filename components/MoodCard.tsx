import React from 'react';
import type { MoodVector } from '../types';

interface MoodCardProps {
  mood: MoodVector;
}

const Bar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => {
  const pct = Math.round(value * 100);
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm text-gray-300 mb-1">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-3 bg-gray-700 rounded">
        <div className={`h-3 rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const MoodCard: React.FC<MoodCardProps> = ({ mood }) => {
  return (
    <div className="w-full max-w-4xl mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700 shadow">
      <h3 className="text-lg font-semibold text-purple-300 mb-2">Mood Levels</h3>
      <Bar label="Adventure" value={mood.adventure} color="bg-green-500" />
      <Bar label="Danger" value={mood.danger} color="bg-red-500" />
      <Bar label="Romance" value={mood.romance} color="bg-pink-500" />
      <Bar label="Drama" value={mood.drama} color="bg-yellow-500" />
    </div>
  );
};

export default MoodCard;


