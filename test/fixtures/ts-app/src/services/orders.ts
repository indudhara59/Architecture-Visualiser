import { db } from '../data/db';
import { format } from '~utils';
import { notify } from './notify';
export const createOrder = () => notify(format(db));
