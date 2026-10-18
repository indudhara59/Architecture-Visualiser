import React from 'react';
import { db } from '../data/db';
export * from './Button';
export const App = () => <div>{String(db)}</div>;
