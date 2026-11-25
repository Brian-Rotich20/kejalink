import type { FastifyReply, FastifyRequest } from "fastify";
import { paginated, success } from "../../lib/response";
import type { IdParam } from "../../lib/validation";
import { getUser } from "../../plugins/auth";
import type { CreateBookingBody, ListBookingsQuery, RejectBookingBody } from "./booking.schema";
import * as bookingService from "./booking.service";

const viewerOf = (request: FastifyRequest) => {
  const user = getUser(request);
  return { id: user.id, role: user.role };
};

export async function create(request: FastifyRequest<{ Body: CreateBookingBody }>, reply: FastifyReply) {
  const booking = await bookingService.createBooking(viewerOf(request).id, request.body);
  return reply.code(201).send(success(booking));
}

export async function listMine(request: FastifyRequest<{ Querystring: ListBookingsQuery }>) {
  return paginated(await bookingService.listSeekerBookings(viewerOf(request), request.query));
}

export async function listReceived(request: FastifyRequest<{ Querystring: ListBookingsQuery }>) {
  return paginated(await bookingService.listReceivedBookings(viewerOf(request), request.query));
}

export async function getById(request: FastifyRequest<{ Params: IdParam }>) {
  return success(await bookingService.getBooking(request.params.id, viewerOf(request)));
}

export async function confirm(request: FastifyRequest<{ Params: IdParam }>) {
  return success(await bookingService.confirmBooking(request.params.id, viewerOf(request).id));
}

export async function reject(request: FastifyRequest<{ Params: IdParam; Body: RejectBookingBody }>) {
  const reason = request.body?.reason ?? null;
  return success(await bookingService.rejectBooking(request.params.id, viewerOf(request).id, reason));
}

export async function cancel(request: FastifyRequest<{ Params: IdParam }>) {
  return success(await bookingService.cancelBooking(request.params.id, viewerOf(request).id));
}
