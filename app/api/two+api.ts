import { message } from '../../lib/message';

export function GET(): Response {
  return Response.json({ route: 'two', message: message() });
}
