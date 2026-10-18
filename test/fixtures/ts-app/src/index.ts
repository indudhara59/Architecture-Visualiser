import { startServer } from './api/server';
import express from 'express';
import * as fs from 'node:fs';
startServer(express(), fs);
