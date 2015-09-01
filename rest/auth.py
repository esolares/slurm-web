import ldap
from flask import request, abort, jsonify
from settings import settings
from functools import wraps
from itsdangerous import (TimedJSONWebSignatureSerializer
                          as Serializer, BadSignature, SignatureExpired)
import os

secret_key = settings.get('config', 'secret_key')

filtered_keys_by_role = {
    'all': settings.get('roles', 'resticted_fields_for_all').split(','),
    'user': settings.get('roles', 'resticted_fields_for_user').split(','),
    'admin': settings.get('roles', 'resticted_fields_for_admin').split(',')
}
all_restricted = not(settings.get('roles', 'all') == 'all')
users = settings.get('roles', 'user').split(',')
admins = settings.get('roles', 'admin').split(',')

def get_ldap_connection():
    conn = ldap.initialize(settings.get('ldap', 'uri'))
    return conn


def filter_dict(to_filter={}, filtered_keys=[]):
    for key in set(to_filter):
        if key in filtered_keys:
            del to_filter[key]
        else:
            if isinstance(to_filter[key], dict):
                filter_dict(to_filter[key], filtered_keys)


class AuthenticationError(Exception):
    pass


class User(object):
    def __init__(self, username, password, role):
        self.username = username
        self.password = password
        self.role = role

    # create authenticated user
    @staticmethod
    def user(username, password):
        role = User.get_role_from_ldap(username, password)
        return User(username, password, role)

    # create a guest user
    @staticmethod
    def guest():
        return User('guest', 'guest', 'all')

    @staticmethod
    def get_role_from_ldap(username, password):
        # mock LDAP in development
        if os.environ.get('LDAP_ENV') == 'development':
            print "LDAP authentication mocked"
            if username == 'marie' or username == 'pierre':
                if password == 'secret':
                    groupname = 'chimistes'
                    if username in admins or ("@" + groupname) in admins:
                        return 'admin'
                    if username in users or ("@" + groupname) in users:
                        return 'user'
                    return 'all'
            raise AuthenticationError

        # here deal with ldap to get user role
        conn = get_ldap_connection()

        try:
            # authicate user on ldap
            conn.simple_bind_s(
                'uid=%s,ou=%s,%s' % (
                    username,
                    settings.get('ldap', 'ugroup'),
                    settings.get('ldap', 'base')
                ),
                password
            )

            print "User %s authenticated" % username

            # retrieve user's group id
            results = conn.search_s(
                'uid=%s,ou=%s,%s' % (
                    username,
                    settings.get('ldap', 'ugroup'),
                    settings.get('ldap', 'base')
                ),
                ldap.SCOPE_SUBTREE
            )
            print results
            gidNumber = results[0][1]['gidNumber'][0]

            print "User's group number: %s" % gidNumber

            # retrieve user's group name
            filter = 'gidNumber=%s' % gidNumber
            results = conn.search_s(
                'ou=groups,%s' % settings.get('ldap', 'base'),
                ldap.SCOPE_SUBTREE,
                filter
            )
            print results
            groupname = results[0][1]['cn'][0]

            print "User's group name: %s" % groupname

            if username in admins or ("@" + groupname) in admins:
                return 'admin'
            if username in users or ("@" + groupname) in users:
                return 'user'
            return 'all'

        except ldap.INVALID_CREDENTIALS:
            print "Authentication failed: username or password is incorrect."
            raise AuthenticationError

    def generate_auth_token(
        self, expiration=int(settings.get('ldap', 'expiration'))
    ):
        s = Serializer(secret_key, expires_in=expiration)
        token = s.dumps({
            'username': self.username,
            'password': self.password,
            'role':     self.role
        })
        print "generate_auth_token : token -> %s" % token
        return token

    @staticmethod
    def verify_auth_token(token):
        s = Serializer(secret_key)
        try:
            data = s.loads(token)
            print "verify_auth_token : data -> %s" % data
        except SignatureExpired:
            print "verify_auth_token : SignatureExpired "
            return None  # valid token, but expired
        except BadSignature:
            print "verify_auth_token : BadSignature "
            return None  # invalid token
        except TypeError:
            print "verify_auth_token : TypeError"
            return None

        if data['role'] == 'all':
            return User.guest()

        user = User.user(data['username'], data['password'])
        return user


def authentication_verify():
    def decorator(f):
        @wraps(f)
        def inner(*args, **kwargs):
            token = request.json['token']
            if token is None:
                return abort(403)

            user = User.verify_auth_token(token)
            if user is not None:
                if user.role == 'all' and all_restricted:
                    print "role 'all' unauthorized"
                    return abort(403)

                resp = f(*args, **kwargs)
                filter_dict(resp, filtered_keys_by_role[user.role])
                return jsonify(resp)

            return abort(403)

        return inner

    return decorator