import os, sys
from shop.api import routes
from .services.billing import charge
import requests as rq
