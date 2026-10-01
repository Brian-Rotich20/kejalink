import type {  FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../config/auth/better-auth";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {

    const session = await auth.api.getSession({ headers: new Headers(request.headers as Record<string, string>), });

    if (!session?.user) {
        request.user = null;
        return;
    }

    request.user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,  
        image: session.user.image ?? null,
        role: session.user.role as "TENANT" | "SEEKER" | "ADMIN",
        status: session.user.status as "ACTIVE" | "SUSPENDED" | "BANNED",
    }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {

    if(!request.user) {
        return reply.code(401).send({
            success: false,
            error: {
                code: "UNAUTHORIZED",
                message: "Authentication required",
                details: null,
            },
        });
    }
}